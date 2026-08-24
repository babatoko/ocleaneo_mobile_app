import { defineStore } from 'pinia';
import { Preferences } from '@capacitor/preferences';
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
        // Aussi en PWA : @capacitor/preferences retombe sur localStorage dans
        // le navigateur, il n'y a pas de raison de priver la variante web du
        // repli hors ligne.
        Preferences.set({ key: CACHE_KEY, value: JSON.stringify(data) }).catch(() => {});
      } catch (e) {
        // Hors ligne (ex: badge lu sans réseau sur site) : on retombe sur la
        // dernière liste de chantiers connue, pour que le badge NFC reste
        // reconnaissable même sans connexion.
        if (!e.isNetworkError) throw e;
        const { value } = await Preferences.get({ key: CACHE_KEY }).catch(() => ({ value: null }));
        if (value) this.list = JSON.parse(value);
        else throw e;
      }
    },
    select(id) {
      this.selectedId = id;
    },
  },
});
