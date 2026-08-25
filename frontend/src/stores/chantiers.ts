import { defineStore } from 'pinia';
import { Preferences } from '@capacitor/preferences';
import { provider } from '../providers';
import { ProviderNetworkError } from '../providers/DataProvider';
import type { Chantier } from '../types/models';

const CACHE_KEY = 'ocleaneo_chantiers_cache';

interface ChantiersState {
  list: Chantier[];
  selectedId: number | null;
}

export const useChantiersStore = defineStore('chantiers', {
  state: (): ChantiersState => ({
    list: [],
    selectedId: null,
  }),
  actions: {
    async fetchMine(): Promise<void> {
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
        if (!(e instanceof ProviderNetworkError)) throw e;
        const { value } = await Preferences.get({ key: CACHE_KEY }).catch(() => ({ value: null }));
        if (value) this.list = JSON.parse(value);
        else throw e;
      }
    },
    select(id: number): void {
      this.selectedId = id;
    },
  },
});
