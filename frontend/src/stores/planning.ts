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
  },
});
