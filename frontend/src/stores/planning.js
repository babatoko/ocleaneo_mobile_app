import { defineStore } from 'pinia';

export const usePlanningStore = defineStore('planning', {
  state: () => ({
    selectedShift: null,
  }),
  actions: {
    selectShift(shift) {
      this.selectedShift = shift;
    },
  },
});
