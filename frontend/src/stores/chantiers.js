import { defineStore } from 'pinia';
import { Preferences } from '@capacitor/preferences';
import { Capacitor } from '@capacitor/core';
import { provider } from '../providers';

const CACHE_KEY = 'ocleaneo_chantiers_cache';

export const useChantiersStore = defineStore('chantiers', {
  state: () => ({
    list: [],
    selectedId: null,
  }),
  actions: {
    async fetchMine() {
      try {
        const data = await provider.fetchChantiers();
        this.list = data;
        if (Capacitor.isNativePlatform()) {
          Preferences.set({ key: CACHE_KEY, value: JSON.stringify(data) }).catch(() => {});
        }
      } catch (e) {
        // Hors ligne (ex: badge lu sans réseau sur site) : on retombe sur la
        // dernière liste de chantiers connue, pour que le badge NFC reste
        // reconnaissable même sans connexion.
        if (!e.isNetworkError || !Capacitor.isNativePlatform()) throw e;
        const { value } = await Preferences.get({ key: CACHE_KEY });
        if (value) this.list = JSON.parse(value);
        else throw e;
      }
    },
    select(id) {
      this.selectedId = id;
    },
  },
});
