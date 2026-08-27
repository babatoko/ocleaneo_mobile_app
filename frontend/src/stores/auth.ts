import { defineStore } from 'pinia';
import { provider } from '../providers';
import { clearToken, currentToken, saveToken } from '../services/tokenStore';
import type { Employee } from '../types/models';

interface AuthState {
  token: string | null;
  employee: Employee | null;
}

export const useAuthStore = defineStore('auth', {
  state: (): AuthState => ({
    // Lu depuis le cache mémoire du dépôt de jetons, déjà hydraté par
    // loadToken() dans main.ts — l'état d'un store Pinia se construit de
    // façon synchrone, il ne peut pas attendre le stockage sécurisé.
    token: currentToken(),
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
      await saveToken(token);
    },
    async fetchMe(): Promise<void> {
      if (!this.token) return;
      this.employee = await provider.fetchMe();
    },
    logout(): void {
      this.token = null;
      this.employee = null;
      // Volontairement non attendu : la déconnexion doit être immédiate à
      // l'écran. L'effacement disque suit, et rien n'en dépend — le cache
      // mémoire est déjà vidé, donc plus aucune requête ne partira signée.
      void clearToken();
    },
  },
});
