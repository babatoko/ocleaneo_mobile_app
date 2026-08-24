import axios from 'axios';
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
export async function initApiBaseUrl() {
  const { value } = await Preferences.get({ key: BASE_URL_PREF_KEY });
  if (value) restClient.defaults.baseURL = value;
}

export function getApiBaseUrl() {
  return restClient.defaults.baseURL;
}

/** @param {string} url Vide (ou égale à la valeur par défaut) pour revenir à VITE_API_URL. */
export async function setApiBaseUrl(url) {
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
  const token = localStorage.getItem('ocleaneo_token');
  if (token) config.headers.Authorization = `Bearer ${token}`;
  return config;
});

restClient.interceptors.response.use(
  (response) => response,
  (error) => {
    if (error.response?.status === 401) {
      localStorage.removeItem('ocleaneo_token');
    }
    return Promise.reject(error);
  }
);
