import { defineStore } from 'pinia';
import { api } from '../services/api';

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
      const { data } = await api.post('/auth/login', { username, password });
      this.token = data.token;
      this.employee = data.employee;
      localStorage.setItem('ocleaneo_token', data.token);
    },
    async fetchMe() {
      if (!this.token) return;
      const { data } = await api.get('/auth/me');
      this.employee = data;
    },
    logout() {
      this.token = null;
      this.employee = null;
      localStorage.removeItem('ocleaneo_token');
    },
  },
});
