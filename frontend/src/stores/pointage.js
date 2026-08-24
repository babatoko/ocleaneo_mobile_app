import { defineStore } from 'pinia';
import { Capacitor } from '@capacitor/core';
import { NFC } from '@exxili/capacitor-nfc';
import { provider } from '../providers';
import { useAuthStore } from './auth';
import { useChantiersStore } from './chantiers';
import {
  showClockedInNotification,
  clearClockedInNotification,
  scheduleDepartureReminder,
  cancelDepartureReminder,
} from '../services/notifications';
import { hapticSuccess, hapticError, hapticTap } from '../services/haptics';
import { checkGeofence } from '../services/geofence';
import { enqueue, queueLength, flushQueue, watchConnectivity } from '../services/offlineQueue';
import { startOfWeekIso } from '../utils/week';
import { todayIso } from '../utils/date';

function getPosition() {
  return new Promise((resolve) => {
    if (!navigator.geolocation) return resolve(null);
    navigator.geolocation.getCurrentPosition(
      (pos) => resolve({ latitude: pos.coords.latitude, longitude: pos.coords.longitude }),
      () => resolve(null),
      { timeout: 3000 }
    );
  });
}

// Associe chronologiquement les arrivées/départs (en soustrayant les pauses)
// pour obtenir un total d'heures effectivement travaillées. Une session encore
// ouverte (présent ou en pause maintenant) compte jusqu'à l'instant présent,
// pour un compteur qui avance en direct plutôt que de rester figé tant qu'on
// n'a pas badgé le départ.
export function computeWorkedHours(entries, now = new Date()) {
  const sorted = [...entries].sort((a, b) => new Date(a.recorded_at) - new Date(b.recorded_at));
  let totalMs = 0;
  let openIn = null;
  let openPause = null;
  for (const e of sorted) {
    const t = new Date(e.recorded_at);
    if (e.type === 'in') {
      openIn = t;
    } else if (e.type === 'out') {
      if (openIn) totalMs += t - openIn;
      // Badger son départ pendant une pause est un cas réel (l'agent oublie de
      // reprendre puis s'en va) : la pause est alors close par le départ, sans
      // quoi son temps serait compté comme travaillé.
      if (openPause) totalMs -= t - openPause;
      openIn = null;
      openPause = null;
    } else if (e.type === 'pause_start') {
      openPause = t;
    } else if (e.type === 'pause_end') {
      if (openPause) totalMs -= t - openPause;
      openPause = null;
    }
  }
  if (openIn) {
    totalMs += (openPause || now) - openIn;
  }
  return Math.max(0, totalMs / 3600000);
}

// Un seul abonnement NFC/réseau pour toute la durée de vie de l'app : un badge
// peut être lu à tout moment (Android relance même l'app depuis fermée), pas
// seulement quand l'écran Pointage est ouvert.
let listenersReady = false;

export const usePointageStore = defineStore('pointage', {
  state: () => ({
    entries: [],
    todayShifts: [],
    weekEntries: [],
    weekShifts: [],
    scanning: false,
    scanError: '',
    lastMessage: null, // { type: 'queued'|'warn', text } — feedback transitoire non bloquant
    pendingTagUid: null, // badge lu avant que le salarié soit authentifié
    offlineQueueCount: 0,
    // Horloge réactive : sans elle, weekWorkedHours (un getter) ne se
    // recalculerait jamais, puisqu'un `new Date()` interne n'est pas une
    // dépendance réactive. Le compteur resterait figé à la valeur du
    // chargement, alors qu'il est censé avancer tant que la session est
    // ouverte.
    tick: Date.now(),
  }),
  getters: {
    lastEntry: (state) => state.entries[state.entries.length - 1],

    // Dérivé des pointages du jour plutôt que d'un champ serveur séparé, pour
    // rester correct même sur des entrées encore en attente de synchro.
    status() {
      const last = this.lastEntry;
      if (!last) return 'out';
      if (last.type === 'pause_start') return 'paused';
      if (last.type === 'pause_end') return 'in';
      return last.type; // 'in' | 'out'
    },

    // Départ estimé pour une vacation : l'horaire de fin planifié décalé du
    // même écart que celui constaté entre l'arrivée réelle et le début prévu.
    estimatedDepartureFor() {
      return (shift) => {
        if (!this.lastEntry) return null;
        const delayMs = new Date(this.lastEntry.recorded_at) - new Date(shift.start_at);
        return new Date(new Date(shift.end_at).getTime() + delayMs);
      };
    },

    // Prochaine vacation du jour qui démarre après celle donnée, tous
    // chantiers confondus.
    nextShiftAfter() {
      return (shift) => {
        const upcoming = this.todayShifts
          .filter((s) => new Date(s.start_at) > new Date(shift.start_at))
          .sort((a, b) => new Date(a.start_at) - new Date(b.start_at));
        return upcoming[0] || null;
      };
    },

    weekPlannedHours: (state) =>
      state.weekShifts.reduce((sum, s) => sum + (new Date(s.end_at) - new Date(s.start_at)) / 3600000, 0),
    weekWorkedHours: (state) => computeWorkedHours(state.weekEntries, new Date(state.tick)),
    weekOvertimeHours() {
      return Math.max(0, this.weekWorkedHours - this.weekPlannedHours);
    },
  },
  actions: {
    async load() {
      const [shiftsData, entriesData] = await Promise.all([
        provider.fetchShifts({ from: todayIso(), to: todayIso() }),
        provider.fetchTodayTimeEntries(),
      ]);
      this.todayShifts = shiftsData;
      this.entries = entriesData.entries;
    },

    // Comme load(), mais ne fait pas échouer l'appelant hors ligne : on garde
    // les dernières données connues plutôt que de bloquer un pointage.
    async loadSafe() {
      try {
        await this.load();
      } catch (e) {
        if (!e.isNetworkError) throw e;
      }
    },

    async loadWeekSummary() {
      const from = startOfWeekIso(todayIso());
      const to = todayIso();
      const [shiftsData, entriesData] = await Promise.all([
        provider.fetchShifts({ from, to }),
        provider.fetchTimeEntries({ from, to }),
      ]);
      this.weekShifts = shiftsData;
      this.weekEntries = entriesData;
    },

    async refreshQueueCount() {
      this.offlineQueueCount = await queueLength();
    },

    /** Avance l'horloge du store — appelée par l'écran Pointage tant qu'il est
     *  affiché, pour que le total d'heures de la semaine progresse en direct. */
    updateTick() {
      this.tick = Date.now();
    },

    async flushOfflineQueue() {
      const { flushed } = await flushQueue();
      await this.refreshQueueCount();
      if (flushed > 0) await this.loadSafe();
    },

    initOfflineSync() {
      watchConnectivity(() => this.flushOfflineQueue());
      this.refreshQueueCount();
    },

    async postEntry(type, { chantierId, shiftId, position, geo } = {}) {
      const recordedAt = new Date().toISOString();
      const payload = {
        chantierId,
        shiftId,
        type,
        recordedAt,
        ...(position || {}),
        ...(geo ? { outOfRange: !geo.withinRange } : {}),
      };

      try {
        await provider.createTimeEntry(payload);
        await this.loadSafe();
        this.lastMessage =
          geo && !geo.withinRange
            ? { type: 'warn', text: `Position à ~${geo.distanceMeters} m du chantier — pointage tout de même enregistré.` }
            : null;
      } catch (e) {
        if (!e.isNetworkError) throw e;
        await enqueue(payload);
        await this.refreshQueueCount();
        // Mise à jour optimiste locale pour un retour immédiat à l'écran, même
        // hors ligne — resynchronisée dès que possible.
        this.entries = [
          ...this.entries,
          { id: `pending-${recordedAt}`, type, chantier_id: chantierId, recorded_at: recordedAt, pending: true },
        ];
        this.lastMessage = { type: 'queued', text: 'Hors ligne : pointage enregistré, synchronisation dès que possible.' };
      }
    },

    async clockWithTag(uid) {
      this.scanError = '';
      const chantiers = useChantiersStore();
      if (!chantiers.list.length) await chantiers.fetchMine();
      const chantier = chantiers.list.find(
        (c) => c.nfc_tag_id && c.nfc_tag_id.toLowerCase() === uid.toLowerCase()
      );
      if (!chantier) {
        this.scanError = 'Badge non reconnu. Contactez votre responsable.';
        hapticError();
        return;
      }

      await this.loadSafe();
      const position = await getPosition();
      const geo = checkGeofence(position, chantier);
      const lastForChantier = [...this.entries]
        .reverse()
        .find((e) => e.chantier_id === chantier.id && (e.type === 'in' || e.type === 'out'));
      const shift = this.todayShifts.find((s) => s.chantier_id === chantier.id);
      const type = lastForChantier?.type === 'in' ? 'out' : 'in';

      await this.postEntry(type, { chantierId: chantier.id, shiftId: shift?.id, position, geo });
      hapticSuccess();

      if (type === 'in' && shift) {
        const next = this.nextShiftAfter(shift);
        const estimatedDeparture = this.estimatedDepartureFor(shift);
        await showClockedInNotification({
          chantierName: chantier.name,
          arrivalAt: this.lastEntry.recorded_at,
          estimatedDeparture,
          next: next ? { chantierName: next.chantier_name, startAt: next.start_at } : null,
        });
        await scheduleDepartureReminder({ chantierName: chantier.name, estimatedDeparture });
      } else {
        await clearClockedInNotification();
        await cancelDepartureReminder();
      }
    },

    // Pause / reprise : action manuelle (le badge du chantier ne peut pas à
    // lui seul distinguer « je pars » de « je fais une pause »).
    async startPause() {
      if (this.status !== 'in' || !this.lastEntry) return;
      hapticTap();
      const shift = this.todayShifts.find((s) => s.chantier_id === this.lastEntry.chantier_id);
      await this.postEntry('pause_start', { chantierId: this.lastEntry.chantier_id, shiftId: shift?.id });
    },

    async endPause() {
      if (this.status !== 'paused' || !this.lastEntry) return;
      hapticTap();
      const shift = this.todayShifts.find((s) => s.chantier_id === this.lastEntry.chantier_id);
      await this.postEntry('pause_end', { chantierId: this.lastEntry.chantier_id, shiftId: shift?.id });
    },

    initGlobalListener(router) {
      if (listenersReady || !Capacitor.isNativePlatform()) return;
      listenersReady = true;

      NFC.onRead((data) => {
        const uid = data.string()?.tagInfo?.uid;
        if (uid) this.handleTagRead(uid, router);
      });
      NFC.onError((err) => {
        this.scanError = err.error || 'Erreur de lecture NFC.';
        this.scanning = false;
      });
    },

    async handleTagRead(uid, router) {
      const auth = useAuthStore();
      if (!auth.isAuthenticated) {
        // L'app vient peut-être d'être lancée par ce tap : on garde le badge en
        // attente et on le traitera juste après la connexion.
        this.pendingTagUid = uid;
        if (router.currentRoute.value.name !== 'login') {
          router.push({ name: 'login' });
        }
        return;
      }

      this.scanning = true;
      try {
        await this.clockWithTag(uid);
      } finally {
        this.scanning = false;
      }
      if (router.currentRoute.value.name !== 'pointage') {
        router.push({ name: 'pointage' });
      }
    },

    async consumePendingTag(router) {
      if (!this.pendingTagUid) return;
      const uid = this.pendingTagUid;
      this.pendingTagUid = null;
      await this.handleTagRead(uid, router);
    },
  },
});
