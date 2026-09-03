import { defineStore } from 'pinia';
import { Preferences } from '@capacitor/preferences';
import { provider } from '../providers';
import { ProviderError, ProviderNetworkError } from '../providers/DataProvider';
import { syncShifts } from '../services/planningSync';
import { startOfMonthIso, endOfMonthIso } from '../utils/week';
import { todayIso, addDaysIso } from '../utils/date';
import type { Shift } from '../types/models';

// Nombre de jours (aujourd'hui inclus) couverts par prefetchUpcoming()
// ci-dessous — voir sa docstring.
const UPCOMING_DAYS = 15;
const UPCOMING_CACHE_KEY = 'ocleaneo_shifts_upcoming';

interface UpcomingCache {
  from: string;
  to: string;
  data: Shift[];
}

/** Repli supplémentaire quand la plage exacte demandée n'a jamais été
 *  visitée individuellement (donc jamais mise en cache par elle-même) mais
 *  tombe dans la fenêtre glissante rafraîchie par prefetchUpcoming(). */
async function fromUpcomingCache(from: string, to: string): Promise<Shift[] | null> {
  const { value } = await Preferences.get({ key: UPCOMING_CACHE_KEY }).catch(() => ({ value: null }));
  if (!value) return null;
  const cache: UpcomingCache = JSON.parse(value);
  if (from < cache.from || to > cache.to) return null;
  return cache.data.filter((s) => {
    const day = s.start_at.slice(0, 10);
    return day >= from && day <= to;
  });
}

// Clé du cache exact pour un seul jour (loadDay) — construite de la même
// façon que fetchShiftsCached() ci-dessous, dupliquée ici pour que
// markShiftDone() n'ait pas besoin d'importer fetchShiftsCached() lui-même.
function dayCacheKey(dateIso: string): string {
  return `ocleaneo_shifts_${dateIso}_${dateIso}`;
}

function withShiftDone(shifts: Shift[], shiftId: number): { data: Shift[]; changed: boolean } {
  let changed = false;
  const data = shifts.map((s) => {
    // Une vacation annulée ne redevient jamais "terminée" — l'annulation
    // reste la vérité, un départ badgé dessus n'aurait de toute façon pas dû
    // pouvoir se produire.
    if (s.id !== shiftId || s.status === 'done' || s.status === 'cancelled') return s;
    changed = true;
    return { ...s, status: 'done' as const };
  });
  return { data, changed };
}

// Cache local par plage de dates exacte (from/to) : hors ligne, on retombe
// sur la dernière réponse connue pour cette même plage plutôt que sur un
// écran vide.
async function fetchShiftsCached(from: string, to: string): Promise<Shift[]> {
  const cacheKey = `ocleaneo_shifts_${from}_${to}`;
  try {
    const data = await provider.fetchShifts({ from, to });
    // Pas de garde sur la plateforme : @capacitor/preferences retombe sur
    // localStorage dans le navigateur, la PWA installable doit donc profiter
    // du même repli hors ligne que les applications natives.
    Preferences.set({ key: cacheKey, value: JSON.stringify(data) }).catch(() => {});
    return data;
  } catch (e) {
    if (!(e instanceof ProviderNetworkError)) throw e;
    const { value } = await Preferences.get({ key: cacheKey }).catch(() => ({ value: null }));
    if (value) return JSON.parse(value);
    const upcoming = await fromUpcomingCache(from, to);
    if (upcoming) return upcoming;
    throw e;
  }
}

interface PlanningState {
  selectedShift: Shift | null;
  dayShifts: Shift[];
  weekShiftsByDay: Record<string, Shift[]>;
  monthShifts: Shift[];
  loading: boolean;
  error: string;
}

export const usePlanningStore = defineStore('planning', {
  state: (): PlanningState => ({
    selectedShift: null,
    dayShifts: [],
    weekShiftsByDay: {},
    monthShifts: [],
    loading: false,
    // Un échec de chargement doit être visible : sans ça, l'écran affiche
    // « aucune vacation », ce qui laisse croire à une journée libre.
    error: '',
  }),
  actions: {
    selectShift(shift: Shift): void {
      this.selectedShift = shift;
    },

    errorMessage(e: unknown): string {
      if (e instanceof ProviderNetworkError) return 'Pas de connexion — le planning n\'a pas pu être chargé.';
      // Le backend renvoie un message technique en anglais ("unauthorized")
      // pour un jeton expiré/révoqué — ne jamais le montrer tel quel, même
      // brièvement le temps que la reconnexion automatique (main.ts,
      // services/sessionEvents.ts) ramène l'agent à l'écran de connexion.
      if (e instanceof ProviderError && (e.status === 401 || e.status === 403)) {
        return 'Session expirée — reconnexion en cours…';
      }
      return e instanceof Error ? e.message || 'Planning indisponible.' : 'Planning indisponible.';
    },

    async loadDay(dateIso: string): Promise<void> {
      this.loading = true;
      this.error = '';
      try {
        this.dayShifts = await fetchShiftsCached(dateIso, dateIso);
        await syncShifts(this.dayShifts);
      } catch (e) {
        this.error = this.errorMessage(e);
        this.dayShifts = [];
      } finally {
        this.loading = false;
      }
    },

    async loadWeek(startIso: string, endIso: string): Promise<void> {
      this.loading = true;
      this.error = '';
      try {
        const data = await fetchShiftsCached(startIso, endIso);
        const byDay: Record<string, Shift[]> = {};
        for (const s of data) {
          const day = s.start_at.slice(0, 10);
          (byDay[day] ||= []).push(s);
        }
        this.weekShiftsByDay = byDay;
        await syncShifts(data);
      } catch (e) {
        this.error = this.errorMessage(e);
        this.weekShiftsByDay = {};
      } finally {
        this.loading = false;
      }
    },

    async loadMonth(dateIso: string): Promise<void> {
      this.loading = true;
      this.error = '';
      try {
        const from = startOfMonthIso(dateIso);
        const to = endOfMonthIso(dateIso);
        this.monthShifts = await fetchShiftsCached(from, to);
        await syncShifts(this.monthShifts);
      } catch (e) {
        this.error = this.errorMessage(e);
        this.monthShifts = [];
      } finally {
        this.loading = false;
      }
    },

    /**
     * Rafraîchit en tâche de fond le cache des UPCOMING_DAYS prochains jours
     * (aujourd'hui inclus) en un seul appel, pour que le planning reste
     * consultable hors ligne au-delà des seuls jour/semaine/mois déjà
     * ouverts individuellement — voir fromUpcomingCache() ci-dessus. Pensée
     * pour un appel silencieux au démarrage (main.ts) : n'affecte ni
     * `loading` ni `error`, et un échec (hors ligne dès l'ouverture, serveur
     * indisponible...) n'a aucune conséquence visible — les caches par-plage
     * déjà constitués restent le repli principal en attendant le prochain
     * démarrage.
     */
    async prefetchUpcoming(): Promise<void> {
      try {
        const from = todayIso();
        const to = addDaysIso(from, UPCOMING_DAYS - 1);
        const data = await provider.fetchShifts({ from, to });
        const cache: UpcomingCache = { from, to, data };
        await Preferences.set({ key: UPCOMING_CACHE_KEY, value: JSON.stringify(cache) });
      } catch {
        // Silencieux — voir la docstring ci-dessus.
      }
    },

    /**
     * Un départ badgé clôture la commande FSM correspondante côté serveur
     * (ocleaneo#11) — appelé par pointage.ts juste après. Sans ça, le cache
     * glissant de prefetchUpcoming() et le cache exact du jour (loadDay)
     * gardent le statut d'avant le départ : un agent qui repasse hors ligne
     * avant le prochain fetch réussi verrait cette vacation réapparaître "à
     * faire" au lieu de "terminée" dans une vue Planning retombée sur l'un
     * de ces caches.
     *
     * Best-effort et silencieux comme prefetchUpcoming() : rien de ceci
     * n'est visible si ça échoue, la prochaine synchronisation en ligne
     * remettra de toute façon les caches à jour.
     */
    async markShiftDone(shiftId: number): Promise<void> {
      this.dayShifts = withShiftDone(this.dayShifts, shiftId).data;
      for (const day of Object.keys(this.weekShiftsByDay)) {
        this.weekShiftsByDay[day] = withShiftDone(this.weekShiftsByDay[day], shiftId).data;
      }
      this.monthShifts = withShiftDone(this.monthShifts, shiftId).data;

      try {
        const { value } = await Preferences.get({ key: UPCOMING_CACHE_KEY });
        if (value) {
          const cache: UpcomingCache = JSON.parse(value);
          const { data, changed } = withShiftDone(cache.data, shiftId);
          if (changed) {
            await Preferences.set({ key: UPCOMING_CACHE_KEY, value: JSON.stringify({ ...cache, data }) });
          }
        }

        const todayKey = dayCacheKey(todayIso());
        const { value: dayValue } = await Preferences.get({ key: todayKey });
        if (dayValue) {
          const { data, changed } = withShiftDone(JSON.parse(dayValue), shiftId);
          if (changed) {
            await Preferences.set({ key: todayKey, value: JSON.stringify(data) });
          }
        }
      } catch {
        // Best-effort — voir la docstring ci-dessus.
      }
    },
  },
});
