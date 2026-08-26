import axios from 'axios';
import { Preferences } from '@capacitor/preferences';

// Client HTTP interne à OdooProvider — même rôle que restClient.ts pour
// RestProvider : rien en dehors de providers/OdooProvider.ts ne doit
// importer ce fichier.
export const DEFAULT_ODOO_BASE_URL = import.meta.env.VITE_ODOO_API_URL || 'http://localhost:8069/api/mobile';

const BASE_URL_PREF_KEY = 'ocleaneo_odoo_api_base_url';

export const odooClient = axios.create({
  baseURL: DEFAULT_ODOO_BASE_URL,
});

/** À appeler une fois au démarrage, avant le premier appel réseau : applique
 *  une éventuelle URL de serveur personnalisée (réglée depuis le profil). */
export async function initOdooBaseUrl(): Promise<void> {
  const { value } = await Preferences.get({ key: BASE_URL_PREF_KEY });
  if (value) odooClient.defaults.baseURL = value;
}

export function getOdooBaseUrl(): string | undefined {
  return odooClient.defaults.baseURL;
}

/** @param url Vide (ou égale à la valeur par défaut) pour revenir à VITE_ODOO_API_URL. */
export async function setOdooBaseUrl(url: string): Promise<void> {
  const next = (url || '').trim().replace(/\/+$/, '');
  if (!next || next === DEFAULT_ODOO_BASE_URL) {
    odooClient.defaults.baseURL = DEFAULT_ODOO_BASE_URL;
    await Preferences.remove({ key: BASE_URL_PREF_KEY });
  } else {
    odooClient.defaults.baseURL = next;
    await Preferences.set({ key: BASE_URL_PREF_KEY, value: next });
  }
}

// Même clé que restClient.ts (localStorage['ocleaneo_token']) : un seul
// provider est actif à la fois (voir providers/index.ts), donc stores/
// auth.ts n'a pas besoin de savoir lequel pour écrire le token obtenu par
// login(). Odoo répond en HTTP 200 même pour un token invalide/expiré
// (l'échec est signalé dans le corps JSON-RPC, pas par le statut HTTP) —
// contrairement à restClient.ts, ce client ne peut donc pas nettoyer le
// token sur un intercepteur de réponse générique ; OdooProvider.ts le fait
// lui-même après avoir lu ce corps de réponse (voir callMobile()).
odooClient.interceptors.request.use((config) => {
  const token = localStorage.getItem('ocleaneo_token');
  if (token) config.headers.set('Authorization', `Bearer ${token}`);
  return config;
});
