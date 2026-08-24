import { defineStore } from 'pinia';
import { Preferences } from '@capacitor/preferences';
import { provider } from '../providers';
import { syncShifts } from '../services/planningSync';
import { startOfMonthIso, endOfMonthIso } from '../utils/week';

// Cache local par plage de dates exacte (from/to) : hors ligne, on retombe
// sur la dernière réponse connue pour cette même plage plutôt que sur un
// écran vide.
async function fetchShiftsCached(from, to) {
  const cacheKey = `ocleaneo_shifts_${from}_${to}`;
  try {
    const data = await provider.fetchShifts({ from, to });
    // Pas de garde sur la plateforme : @capacitor/preferences retombe sur
    // localStorage dans le navigateur, la PWA installable doit donc profiter
    // du même repli hors ligne que les applications natives.
    Preferences.set({ key: cacheKey, value: JSON.stringify(data) }).catch(() => {});
    return data;
  } catch (e) {
    if (!e.isNetworkError) throw e;
    const { value } = await Preferences.get({ key: cacheKey }).catch(() => ({ value: null }));
    if (value) return JSON.parse(value);
    throw e;
  }
}

export const usePlanningStore = defineStore('planning', {
  state: () => ({
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
    selectShift(shift) {
      this.selectedShift = shift;
    },

    errorMessage(e) {
      return e.isNetworkError
        ? 'Pas de connexion — le planning n\'a pas pu être chargé.'
        : e.message || 'Planning indisponible.';
    },

    async loadDay(dateIso) {
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

    async loadWeek(startIso, endIso) {
      this.loading = true;
      this.error = '';
      try {
        const data = await fetchShiftsCached(startIso, endIso);
        const byDay = {};
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

    async loadMonth(dateIso) {
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
  },
});
