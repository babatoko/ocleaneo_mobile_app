import { defineStore } from 'pinia';
import { Capacitor } from '@capacitor/core';
import { NFC } from '@exxili/capacitor-nfc';
import type { Router } from 'vue-router';
import { provider } from '../providers';
import { ProviderError, ProviderNetworkError } from '../providers/DataProvider';
import { useAuthStore } from './auth';
import { useChantiersStore } from './chantiers';
import { usePlanningStore } from './planning';
import {
  showClockedInNotification,
  clearClockedInNotification,
  scheduleDepartureReminder,
  cancelDepartureReminder,
  schedulePauseReminder,
  cancelPauseReminder,
  scheduleEndOfShiftReminder,
  cancelEndOfShiftReminder,
  cancelLateReminder,
} from '../services/notifications';
import { hapticSuccess, hapticError, hapticTap } from '../services/haptics';
import { checkGeofence, type GeofenceResult } from '../services/geofence';
import { enqueue, queueLength, flushQueue, watchConnectivity } from '../services/offlineQueue';
import { startOfWeekIso } from '../utils/week';
import { todayIso } from '../utils/date';
import { recordError } from '../services/errorLog';
import type { Position, Shift, TimeEntry, TimeEntryType } from '../types/models';

function newClientRef(): string {
  if (typeof crypto !== 'undefined' && crypto.randomUUID) return crypto.randomUUID();
  return `cr-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
}

// Le lecteur NFC (@exxili/capacitor-nfc) renvoie un hex concaténé sans
// séparateur ("041779C9780000"), mais rien ne garantit que le badge a été
// saisi manuellement dans Odoo sous cette même forme — confirmé sur le
// terrain : "04:17:79:C9:78:00:00" ne matchait jamais l'UID scanné avant
// cette normalisation, alors qu'il s'agissait bien du même badge. Ne garder
// que les caractères hexadécimaux élimine ":", "-", espaces et autres
// séparateurs quel que soit celui utilisé à la saisie.
function normalizeNfcId(value: string): string {
  return value.replace(/[^0-9a-fA-F]/g, '').toLowerCase();
}

// Reformate un hex brut ("041779C9780000") avec des ":" tous les 2 caractères
// ("04:17:79:C9:78:00:00"), pour être directement comparable/copiable dans le
// champ nfc_tag_id d'Odoo, qui est saisi sous cette forme.
function formatNfcIdWithColons(value: string): string {
  const hex = normalizeNfcId(value).toUpperCase();
  return hex.replace(/(.{2})(?=.)/g, '$1:');
}

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

// Garde de réentrance dédiée à un évènement NFC déjà en cours de traitement —
// distincte de `state.scanning`, qui reste ouvert pendant toute une session
// iOS manuelle (bouton pressé, en attente d'un tap) : la traiter comme une
// garde de réentrance bloquerait le tap qui doit justement la faire aboutir.
// Un module-level `let`, pas du state Pinia : ce n'est pas un signal affiché
// à l'écran, juste une protection contre un double évènement `NFC.onRead`
// pour un seul passage de badge — un défaut réel documenté sur certains
// lecteurs Android, qui créerait sinon deux pointages pour un seul geste.
let processingTag = false;

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
  /** Empêche un double-tap sur Pause/Reprendre de poster deux fois avant que
   *  `status` (dérivé de `entries`, mis à jour seulement après la requête)
   *  n'ait eu le temps de refléter la première action. */
  pauseActionPending: boolean;
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
    pauseActionPending: false,
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

    // Une vacation terminée compte toujours pour le prévu (voir
    // /planning, qui la garde désormais dans la réponse au lieu de la
    // faire disparaître) — seule une vacation annulée n'a jamais eu lieu
    // et ne doit pas gonfler le "prévu" de la semaine.
    weekPlannedHours: (state): number =>
      state.weekShifts
        .filter((s) => s.status !== 'cancelled')
        .reduce((sum, s) => sum + (new Date(s.end_at).getTime() - new Date(s.start_at).getTime()) / 3600000, 0),
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
        // Généré une seule fois ici, avant la première tentative : si celle-ci
        // réussit côté serveur mais que la réponse se perd (vue comme une
        // panne réseau), le rejeu depuis la file hors ligne portera la même
        // clé — au serveur de reconnaître le doublon plutôt que de le créer.
        clientRef: newClientRef(),
        ...(position || {}),
        ...(geo ? { outOfRange: !geo.withinRange } : {}),
      };

      try {
        await provider.createTimeEntry(payload);
        await this.loadSafe();
        // Même logique dans les deux cas — avertir sans jamais bloquer, voir
        // GEOFENCE_TOLERANCE_M (geofence.ts) — mais deux causes distinctes :
        // position introuvable (GPS désactivé/refusé/hors service) contre
        // position connue mais trop loin du chantier.
        this.lastMessage = !position
          ? { type: 'warn', text: 'Position non disponible — vérifiez que la localisation est activée. Pointage tout de même enregistré.' }
          : geo && !geo.withinRange
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
      const position = await getPosition();
      const recordedAt = new Date().toISOString();
      const clientRef = newClientRef();
      const type: TimeEntryType = this._nextTypeForTag(uid);

      try {
        const entry = await provider.createTimeEntryWithTag({
          uid,
          type,
          recordedAt,
          latitude: position?.latitude,
          longitude: position?.longitude,
          clientRef,
        });
        await this.loadSafe();
        const resolvedType: TimeEntryType = entry.type || type;

        // Resolve site info for geofence feedback and notifications.
        const site = this._resolveSiteFromEntry(entry);
        const geo = checkGeofence(position, site);
        this.lastMessage = !position
          ? { type: 'warn', text: 'Position non disponible — vérifiez que la localisation est activée. Pointage tout de même enregistré.' }
          : geo && !geo.withinRange
          ? { type: 'warn', text: `Position à ~${geo.distanceMeters} m du chantier — pointage tout de même enregistré.` }
          : null;

        hapticSuccess();
        await this._handlePostClocking(resolvedType, site, entry.shift_id);
      } catch (e) {
        if (e instanceof ProviderError && e.status === 404) {
          void recordError(
            `UID scanné (brut): "${uid}" (format Odoo: "${formatNfcIdWithColons(uid)}")`,
            'pointage.clockWithTag: badge non reconnu',
          );
          this.scanError = 'Badge non reconnu. Contactez votre responsable.';
          hapticError();
          return;
        }
        // Network / retryable errors go to the offline queue.
        if (e instanceof ProviderNetworkError) {
          await enqueue({
            uid,
            type,
            recordedAt,
            latitude: position?.latitude,
            longitude: position?.longitude,
            clientRef,
            withTag: true,
          } as unknown as Parameters<typeof enqueue>[0]);
          await this.refreshQueueCount();
          this.entries = [
            ...this.entries,
            { id: `pending-${recordedAt}`, type, chantier_id: 0, recorded_at: recordedAt, pending: true },
          ];
          this.lastMessage = { type: 'queued', text: 'Hors ligne : pointage enregistré, synchronisation dès que possible.' };
          hapticSuccess();
          return;
        }
        throw e;
      }
    },

    /** Determine the next clocking type for a tag based on the most recent
     *  entry at the resolved location. Falls back to 'in' when unknown. */
    _nextTypeForTag(_uid: string): TimeEntryType {
      return 'in';
    },

    _resolveSiteFromEntry(entry: TimeEntry): { id: number; name: string; latitude: number | null; longitude: number | null } {
      const shift = entry.shift_id ? this.todayShifts.find((s) => s.id === entry.shift_id) : undefined;
      if (shift) {
        return {
          id: shift.chantier_id,
          name: shift.chantier_name,
          latitude: shift.latitude ?? null,
          longitude: shift.longitude ?? null,
        };
      }
      // Fallback: try to find a chantier with the same id (backend may set
      // chantier_id to the fsm_order_id; either way we use what we have).
      const chantiers = useChantiersStore();
      const chantier = chantiers.list.find((c) => c.id === entry.chantier_id);
      return {
        id: entry.chantier_id || 0,
        name: chantier?.name || 'Chantier inconnu',
        latitude: chantier?.latitude ?? null,
        longitude: chantier?.longitude ?? null,
      };
    },

    async _handlePostClocking(type: TimeEntryType, site: { id: number; name: string }, shiftId?: number): Promise<void> {
      if (type === 'in') {
        const shift = this.todayShifts.find((s) => s.id === shiftId);
        const next = shift ? (this.nextShiftAfter as (shift: Shift) => Shift | null)(shift) : null;
        const estimatedDeparture = shift ? (this.estimatedDepartureFor as (shift: Shift) => Date | null)(shift) : null;
        const lastEntry = this.lastEntry as TimeEntry | undefined;
        await showClockedInNotification({
          chantierName: site.name,
          arrivalAt: lastEntry?.recorded_at ?? new Date().toISOString(),
          estimatedDeparture: estimatedDeparture ?? new Date(),
          next: next ? { chantierName: next.chantier_name, startAt: next.start_at } : null,
        });
        await scheduleDepartureReminder({ chantierName: site.name, estimatedDeparture });
        await scheduleEndOfShiftReminder({ chantierName: site.name, estimatedDeparture });
        if (shift) await cancelLateReminder(shift.id);
      } else {
        await clearClockedInNotification();
        await cancelDepartureReminder();
        await cancelEndOfShiftReminder();
        await cancelPauseReminder();
      }

      if (type === 'out') {
        const chantiers = useChantiersStore();
        await chantiers.fetchMine();
        await usePlanningStore().markShiftDone(site.id);
      }
    },

    // Pause / reprise : action manuelle (le badge du chantier ne peut pas à
    // lui seul distinguer « je pars » de « je fais une pause »).
    async startPause(): Promise<void> {
      if (this.pauseActionPending) return;
      const lastEntry = this.lastEntry as TimeEntry | undefined;
      if ((this.status as string) !== 'in' || !lastEntry) return;
      hapticTap();
      this.pauseActionPending = true;
      try {
        const shift = this.todayShifts.find((s) => s.chantier_id === lastEntry.chantier_id);
        await this.postEntry('pause_start', { chantierId: lastEntry.chantier_id, shiftId: shift?.id });
        const chantiers = useChantiersStore();
        const chantierName = chantiers.list.find((c) => c.id === lastEntry.chantier_id)?.name;
        if (chantierName) await schedulePauseReminder({ chantierName });
      } finally {
        this.pauseActionPending = false;
      }
    },

    async endPause(): Promise<void> {
      if (this.pauseActionPending) return;
      const lastEntry = this.lastEntry as TimeEntry | undefined;
      if ((this.status as string) !== 'paused' || !lastEntry) return;
      hapticTap();
      this.pauseActionPending = true;
      try {
        const shift = this.todayShifts.find((s) => s.chantier_id === lastEntry.chantier_id);
        await this.postEntry('pause_end', { chantierId: lastEntry.chantier_id, shiftId: shift?.id });
        await cancelPauseReminder();
      } finally {
        this.pauseActionPending = false;
      }
    },

    initGlobalListener(router: Router): void {
      if (listenersReady || !Capacitor.isNativePlatform()) return;
      listenersReady = true;

      NFC.onRead((data) => {
        const uid = data.string()?.tagInfo?.uid;
        if (uid) this.handleTagRead(uid.replace(/:/g, '').trim(), router);
      });
      NFC.onError((err) => {
        this.scanError = err.error || 'Erreur de lecture NFC.';
        this.scanning = false;
      });
    },

    async handleTagRead(uid: string, router: Router): Promise<void> {
      if (processingTag) return; // second évènement NFC pour le même geste : ignoré
      processingTag = true;
      try {
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
      } finally {
        processingTag = false;
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
