import axios, { AxiosError } from 'axios';
import { clearToken, currentToken } from '../services/tokenStore';
import { emitSessionExpired } from '../services/sessionEvents';
import { Preferences } from '@capacitor/preferences';

// Client HTTP interne au RestProvider : rien en dehors de providers/RestProvider.js
// ne doit importer ce fichier — c'est précisément le détail d'implémentation
// que l'abstraction DataProvider existe pour cacher au reste de l'app.
export const DEFAULT_BASE_URL = import.meta.env.VITE_API_URL || 'http://localhost:3000/api';

const BASE_URL_PREF_KEY = 'ocleaneo_api_base_url';

export const restClient = axios.create({
  baseURL: DEFAULT_BASE_URL,
});

/** À appeler une fois au démarrage, avant le premier appel réseau : applique
 *  une éventuelle URL de serveur personnalisée (réglée depuis le profil). */
export async function initApiBaseUrl(): Promise<void> {
  const { value } = await Preferences.get({ key: BASE_URL_PREF_KEY });
  if (value) restClient.defaults.baseURL = value;
}

export function getApiBaseUrl(): string | undefined {
  return restClient.defaults.baseURL;
}

/** @param url Vide (ou égale à la valeur par défaut) pour revenir à VITE_API_URL. */
export async function setApiBaseUrl(url: string): Promise<void> {
  const next = (url || '').trim().replace(/\/+$/, '');
  if (!next || next === DEFAULT_BASE_URL) {
    restClient.defaults.baseURL = DEFAULT_BASE_URL;
    await Preferences.remove({ key: BASE_URL_PREF_KEY });
  } else {
    restClient.defaults.baseURL = next;
    await Preferences.set({ key: BASE_URL_PREF_KEY, value: next });
  }
}

restClient.interceptors.request.use((config) => {
  const token = currentToken();
  if (token) config.headers.set('Authorization', `Bearer ${token}`);
  return config;
});

restClient.interceptors.response.use(
  (response) => response,
  (error: AxiosError) => {
    if (error.response?.status === 401) {
      void clearToken();
      // Voir OdooProvider.ts / services/sessionEvents.ts : sans ce signal,
      // seul le dépôt de jeton était vidé, jamais le store d'authentification.
      emitSessionExpired();
    }
    return Promise.reject(error);
  }
);
