import { defineStore } from 'pinia';
import { Capacitor } from '@capacitor/core';
import { NFC } from '@exxili/capacitor-nfc';
import type { Router } from 'vue-router';
import { provider } from '../providers';
import { ProviderNetworkError } from '../providers/DataProvider';
import { useAuthStore } from './auth';
import { useChantiersStore } from './chantiers';
import {
  showClockedInNotification,
  clearClockedInNotification,
  scheduleDepartureReminder,
  cancelDepartureReminder,
} from '../services/notifications';
import { hapticSuccess, hapticError, hapticTap } from '../services/haptics';
import { checkGeofence, type GeofenceResult } from '../services/geofence';
import { enqueue, queueLength, flushQueue, watchConnectivity } from '../services/offlineQueue';
import { startOfWeekIso } from '../utils/week';
import { todayIso } from '../utils/date';
import type { Position, Shift, TimeEntry, TimeEntryType } from '../types/models';

function getPosition(): Promise<Position | null> {
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
export function computeWorkedHours(entries: TimeEntry[], now: Date = new Date()): number {
  const sorted = [...entries].sort((a, b) => new Date(a.recorded_at).getTime() - new Date(b.recorded_at).getTime());
  let totalMs = 0;
  let openIn: Date | null = null;
  let openPause: Date | null = null;
  for (const e of sorted) {
    const t = new Date(e.recorded_at);
    if (e.type === 'in') {
      openIn = t;
    } else if (e.type === 'out') {
      if (openIn) totalMs += t.getTime() - openIn.getTime();
      // Badger son départ pendant une pause est un cas réel (l'agent oublie de
      // reprendre puis s'en va) : la pause est alors close par le départ, sans
      // quoi son temps serait compté comme travaillé.
      if (openPause) totalMs -= t.getTime() - openPause.getTime();
      openIn = null;
      openPause = null;
    } else if (e.type === 'pause_start') {
      openPause = t;
    } else if (e.type === 'pause_end') {
      if (openPause) totalMs -= t.getTime() - openPause.getTime();
      openPause = null;
    }
  }
  if (openIn) {
    totalMs += (openPause || now).getTime() - openIn.getTime();
  }
  return Math.max(0, totalMs / 3600000);
}

// Un seul abonnement NFC/réseau pour toute la durée de vie de l'app : un badge
// peut être lu à tout moment (Android relance même l'app depuis fermée), pas
// seulement quand l'écran Pointage est ouvert.
let listenersReady = false;

type PointageMessage = { type: 'queued' | 'warn'; text: string } | null;

interface PostEntryOptions {
  chantierId?: number;
  shiftId?: number;
  position?: Position | null;
  geo?: GeofenceResult | null;
}

interface PointageState {
  entries: TimeEntry[];
  todayShifts: Shift[];
  weekEntries: TimeEntry[];
  weekShifts: Shift[];
  scanning: boolean;
  scanError: string;
  lastMessage: PointageMessage;
  pendingTagUid: string | null;
  offlineQueueCount: number;
  tick: number;
}

export const usePointageStore = defineStore('pointage', {
  state: (): PointageState => ({
    entries: [],
    todayShifts: [],
    weekEntries: [],
    weekShifts: [],
    scanning: false,
    scanError: '',
    lastMessage: null, // feedback transitoire non bloquant
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
    lastEntry: (state): TimeEntry | undefined => state.entries[state.entries.length - 1],

    // Dérivé des pointages du jour plutôt que d'un champ serveur séparé, pour
    // rester correct même sur des entrées encore en attente de synchro.
    status(): 'out' | 'paused' | 'in' {
      const last = this.lastEntry as TimeEntry | undefined;
      if (!last) return 'out';
      if (last.type === 'pause_start') return 'paused';
      if (last.type === 'pause_end') return 'in';
      return last.type as 'in' | 'out';
    },

    // Départ estimé pour une vacation : l'horaire de fin planifié décalé du
    // même écart que celui constaté entre l'arrivée réelle et le début prévu.
    estimatedDepartureFor(): (shift: Shift) => Date | null {
      return (shift: Shift) => {
        const last = this.lastEntry as TimeEntry | undefined;
        if (!last) return null;
        const delayMs = new Date(last.recorded_at).getTime() - new Date(shift.start_at).getTime();
        return new Date(new Date(shift.end_at).getTime() + delayMs);
      };
    },

    // Prochaine vacation du jour qui démarre après celle donnée, tous
    // chantiers confondus.
    nextShiftAfter(): (shift: Shift) => Shift | null {
      return (shift: Shift) => {
        const todayShifts = this.todayShifts as Shift[];
        const upcoming = todayShifts
          .filter((s) => new Date(s.start_at) > new Date(shift.start_at))
          .sort((a, b) => new Date(a.start_at).getTime() - new Date(b.start_at).getTime());
        return upcoming[0] || null;
      };
    },

    weekPlannedHours: (state): number =>
      state.weekShifts.reduce((sum, s) => sum + (new Date(s.end_at).getTime() - new Date(s.start_at).getTime()) / 3600000, 0),
    weekWorkedHours: (state): number => computeWorkedHours(state.weekEntries, new Date(state.tick)),
    weekOvertimeHours(): number {
      return Math.max(0, (this.weekWorkedHours as number) - (this.weekPlannedHours as number));
    },
  },
  actions: {
    async load(): Promise<void> {
      const [shiftsData, entriesData] = await Promise.all([
        provider.fetchShifts({ from: todayIso(), to: todayIso() }),
        provider.fetchTodayTimeEntries(),
      ]);
      this.todayShifts = shiftsData;
      this.entries = entriesData.entries;
    },

    // Comme load(), mais ne fait pas échouer l'appelant hors ligne : on garde
    // les dernières données connues plutôt que de bloquer un pointage.
    async loadSafe(): Promise<void> {
      try {
        await this.load();
      } catch (e) {
        if (!(e instanceof ProviderNetworkError)) throw e;
      }
    },

    async loadWeekSummary(): Promise<void> {
      const from = startOfWeekIso(todayIso());
      const to = todayIso();
      const [shiftsData, entriesData] = await Promise.all([
        provider.fetchShifts({ from, to }),
        provider.fetchTimeEntries({ from, to }),
      ]);
      this.weekShifts = shiftsData;
      this.weekEntries = entriesData;
    },

    async refreshQueueCount(): Promise<void> {
      this.offlineQueueCount = await queueLength();
    },

    /** Avance l'horloge du store — appelée par l'écran Pointage tant qu'il est
     *  affiché, pour que le total d'heures de la semaine progresse en direct. */
    updateTick(): void {
      this.tick = Date.now();
    },

    async flushOfflineQueue(): Promise<void> {
      const { flushed } = await flushQueue();
      await this.refreshQueueCount();
      if (flushed > 0) await this.loadSafe();
    },

    initOfflineSync(): void {
      watchConnectivity(() => this.flushOfflineQueue());
      this.refreshQueueCount();
    },

    async postEntry(type: TimeEntryType, { chantierId, shiftId, position, geo }: PostEntryOptions = {}): Promise<void> {
      const recordedAt = new Date().toISOString();
      const payload = {
        chantierId: chantierId as number,
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
        if (!(e instanceof ProviderNetworkError)) throw e;
        await enqueue(payload);
        await this.refreshQueueCount();
        // Mise à jour optimiste locale pour un retour immédiat à l'écran, même
        // hors ligne — resynchronisée dès que possible.
        this.entries = [
          ...this.entries,
          { id: `pending-${recordedAt}`, type, chantier_id: chantierId as number, recorded_at: recordedAt, pending: true },
        ];
        this.lastMessage = { type: 'queued', text: 'Hors ligne : pointage enregistré, synchronisation dès que possible.' };
      }
    },

    async clockWithTag(uid: string): Promise<void> {
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
      const type: TimeEntryType = lastForChantier?.type === 'in' ? 'out' : 'in';

      await this.postEntry(type, { chantierId: chantier.id, shiftId: shift?.id, position, geo });
      hapticSuccess();

      if (type === 'in' && shift) {
        const next = (this.nextShiftAfter as (shift: Shift) => Shift | null)(shift);
        const estimatedDeparture = (this.estimatedDepartureFor as (shift: Shift) => Date | null)(shift);
        const lastEntry = this.lastEntry as TimeEntry | undefined;
        await showClockedInNotification({
          chantierName: chantier.name,
          arrivalAt: lastEntry?.recorded_at ?? new Date().toISOString(),
          estimatedDeparture: estimatedDeparture ?? new Date(),
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
    async startPause(): Promise<void> {
      const lastEntry = this.lastEntry as TimeEntry | undefined;
      if ((this.status as string) !== 'in' || !lastEntry) return;
      hapticTap();
      const shift = this.todayShifts.find((s) => s.chantier_id === lastEntry.chantier_id);
      await this.postEntry('pause_start', { chantierId: lastEntry.chantier_id, shiftId: shift?.id });
    },

    async endPause(): Promise<void> {
      const lastEntry = this.lastEntry as TimeEntry | undefined;
      if ((this.status as string) !== 'paused' || !lastEntry) return;
      hapticTap();
      const shift = this.todayShifts.find((s) => s.chantier_id === lastEntry.chantier_id);
      await this.postEntry('pause_end', { chantierId: lastEntry.chantier_id, shiftId: shift?.id });
    },

    initGlobalListener(router: Router): void {
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

    async handleTagRead(uid: string, router: Router): Promise<void> {
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

    async consumePendingTag(router: Router): Promise<void> {
      if (!this.pendingTagUid) return;
      const uid = this.pendingTagUid;
      this.pendingTagUid = null;
      await this.handleTagRead(uid, router);
    },
  },
});
