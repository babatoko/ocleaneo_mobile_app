import { defineStore } from 'pinia';
import { provider } from '../providers';

export const useAuthStore = defineStore('auth', {
  state: () => ({
    token: localStorage.getItem('ocleaneo_token') || null,
    employee: null,
  }),
  getters: {
    isAuthenticated: (state) => !!state.token,
  },
  actions: {
    async login(username, password) {
      const { token, employee } = await provider.login(username, password);
      this.token = token;
      this.employee = employee;
      localStorage.setItem('ocleaneo_token', token);
    },
    async fetchMe() {
      if (!this.token) return;
      this.employee = await provider.fetchMe();
    },
    logout() {
      this.token = null;
      this.employee = null;
      localStorage.removeItem('ocleaneo_token');
    },
  },
});
