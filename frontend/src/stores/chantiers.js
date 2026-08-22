import { defineStore } from 'pinia';
import { api } from '../services/api';

export const useChantiersStore = defineStore('chantiers', {
  state: () => ({
    list: [],
    selectedId: null,
  }),
  actions: {
    async fetchMine() {
      const { data } = await api.get('/chantiers/mine');
      this.list = data;
    },
    select(id) {
      this.selectedId = id;
    },
  },
});
