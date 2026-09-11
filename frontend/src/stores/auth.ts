import { defineStore } from 'pinia';
import { provider } from '../providers';
import { clearAllUserData } from '../services/userDataCleanup';
import { clearToken, currentToken, saveToken } from '../services/tokenStore';
import type { Employee, MobileModuleFlag } from '../types/models';

interface AuthState {
  token: string | null;
  employee: Employee | null;
  /** Feature flags résolus pour cet utilisateur par le backend (login +
   *  /auth/me). Vides = aucun flag connu : les écrans pilotés par un flag
   *  restent masqués (défaut conservateur) jusqu'au premier login/fetchMe. */
  modules: MobileModuleFlag[];
}

/** True si la feature est disponible pour cet utilisateur. Un flag absent de
 *  la liste = masqué — le backend n'envoie que ce qui est actif ET ciblé. */
export function isModuleActive(
  modules: MobileModuleFlag[],
  technicalName: string,
): boolean {
  return modules.some((m) => m.technical_name === technicalName && m.is_active);
}

export const useAuthStore = defineStore('auth', {
  state: (): AuthState => ({
    // Lu depuis le cache mémoire du dépôt de jetons, déjà hydraté par
    // loadToken() dans main.ts — l'état d'un store Pinia se construit de
    // façon synchrone, il ne peut pas attendre le stockage sécurisé.
    token: currentToken(),
    employee: null,
    modules: [],
  }),
  getters: {
    isAuthenticated: (state): boolean => !!state.token,
  },
  actions: {
    async login(username: string, password: string): Promise<void> {
      const { token, employee, modules } = await provider.login(username, password);
      this.token = token;
      this.employee = employee;
      this.modules = modules ?? [];
      await saveToken(token);
    },

    async changePassword(currentPassword: string, newPassword: string): Promise<void> {
      await provider.changePassword(currentPassword, newPassword);
      this.logout();
    },
    async fetchMe(): Promise<void> {
      if (!this.token) return;
      const { employee, modules } = await provider.fetchMe();
      this.employee = employee;
      if (modules) this.modules = modules;
    },
    logout(): void {
      this.token = null;
      this.employee = null;
      this.modules = [];
      // Volontairement non attendu : la déconnexion doit être immédiate à
      // l'écran. L'effacement disque suit, et rien n'en dépend — le cache
      // mémoire est déjà vidé, donc plus aucune requête ne partira signée.
      void clearToken();
      // Efface aussi les caches planning/pointage/chantiers, la file hors
      // ligne et les identifiants biométriques, pour qu'un autre utilisateur
      // qui se connecte ensuite ne voie jamais les données du précédent.
      void clearAllUserData();
    },
  },
});
