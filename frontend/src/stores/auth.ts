import { defineStore } from 'pinia';
import { provider } from '../providers';
import type { Employee } from '../types/models';

interface AuthState {
  token: string | null;
  employee: Employee | null;
}

export const useAuthStore = defineStore('auth', {
  state: (): AuthState => ({
    token: localStorage.getItem('ocleaneo_token') || null,
    employee: null,
  }),
  getters: {
    isAuthenticated: (state): boolean => !!state.token,
  },
  actions: {
    async login(username: string, password: string): Promise<void> {
      const { token, employee } = await provider.login(username, password);
      this.token = token;
      this.employee = employee;
      localStorage.setItem('ocleaneo_token', token);
    },
    async fetchMe(): Promise<void> {
      if (!this.token) return;
      this.employee = await provider.fetchMe();
    },
    logout(): void {
      this.token = null;
      this.employee = null;
      localStorage.removeItem('ocleaneo_token');
    },
  },
});
