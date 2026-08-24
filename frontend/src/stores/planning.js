import { defineStore } from 'pinia';
import { Capacitor } from '@capacitor/core';
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
    if (Capacitor.isNativePlatform()) {
      Preferences.set({ key: cacheKey, value: JSON.stringify(data) }).catch(() => {});
    }
    return data;
  } catch (e) {
    if (!e.isNetworkError || !Capacitor.isNativePlatform()) throw e;
    const { value } = await Preferences.get({ key: cacheKey });
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
  }),
  actions: {
    selectShift(shift) {
      this.selectedShift = shift;
    },

    async loadDay(dateIso) {
      this.loading = true;
      try {
        this.dayShifts = await fetchShiftsCached(dateIso, dateIso);
        await syncShifts(this.dayShifts);
      } finally {
        this.loading = false;
      }
    },

    async loadWeek(startIso, endIso) {
      this.loading = true;
      try {
        const data = await fetchShiftsCached(startIso, endIso);
        const byDay = {};
        for (const s of data) {
          const day = s.start_at.slice(0, 10);
          (byDay[day] ||= []).push(s);
        }
        this.weekShiftsByDay = byDay;
        await syncShifts(data);
      } finally {
        this.loading = false;
      }
    },

    async loadMonth(dateIso) {
      this.loading = true;
      try {
        const from = startOfMonthIso(dateIso);
        const to = endOfMonthIso(dateIso);
        this.monthShifts = await fetchShiftsCached(from, to);
        await syncShifts(this.monthShifts);
      } finally {
        this.loading = false;
      }
    },
  },
});
