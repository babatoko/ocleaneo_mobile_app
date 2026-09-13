import { Preferences } from '@capacitor/preferences';
import { cancelAllNotifications } from './notifications';
import { clearSavedCredentials } from './biometric';

/**
 * Registre central des clés persistantes de l'application (F04 de l'audit du
 * 13/09 : 19 littéraux `ocleaneo_*` éclatés sur 10 fichiers, dont des clés
 * fantômes dans les listes de purge — la whitelist de logout citait
 * `ocleaneo_server_url`/`ocleaneo_trace_mode` qui n'existent nulle part, les
 * vraies clés étant `ocleaneo_api_base_url`/`ocleaneo_odoo_api_base_url` et
 * `ocleaneo_trace_mode_enabled`).
 *
 * Toute nouvelle clé persistante DOIT vivre ici :
 * - `userSpecific: true`  → effacée à la déconnexion (appareil partagé) ;
 * - `userSpecific: false` → conservée (réglages globaux de l'app).
 *
 * Les préfixes (caches par jour/employé/signature) sont marqués `prefix` :
 * la purge matche par `startsWith`.
 */
export interface StoredKey {
  /** Clé exacte, ou préfixe quand `prefix: true`. */
  key: string;
  /** true = données du salarié connecté, purgées au logout. */
  userSpecific: boolean;
  /** true = match par préfixe (une clé par jour/employé/signature). */
  prefix?: boolean;
}

export const STORED_KEYS: StoredKey[] = [
  // --- Caches & files du salarié (purgés au logout) ---
  { key: 'ocleaneo_shifts_', userSpecific: true, prefix: true }, // caches planning (jour/semaine/mois/upcoming)
  { key: 'ocleaneo_chantiers_cache', userSpecific: true },
  { key: 'ocleaneo_pointage_pending_compte_rendu', userSpecific: true },
  { key: 'ocleaneo_pointage_offline_queue', userSpecific: true },
  { key: 'ocleaneo_pointage_failed_entries', userSpecific: true },
  { key: 'ocleaneo_tour_seen_', userSpecific: true, prefix: true }, // tour guidé, par employé
  // F02 : itinéraires OSRM (JSON complet : noms, adresses, coordonnées des
  // chantiers du salarié) — jamais purgés avant, et sans expiration. Sur un
  // appareil partagé, l'itinéraire du salarié précédent survivait à la
  // déconnexion.
  { key: 'ocleaneo_trip_', userSpecific: true, prefix: true },
  // F02 : snapshot du planning (empreintes des vacations, champ note inclus).
  { key: 'ocleaneo_planning_snapshot', userSpecific: true },

  // Préférences de confort du salarié, sans donnée de chantier :
  // conservées pour que le successeur sur un appareil partagé ne reparte
  // pas de zéro (choix assumé — ce ne sont pas des données personnelles
  // de travail).
  { key: 'ocleaneo_last_username', userSpecific: false }, // LoginView (pré-remplissage login)
  { key: 'ocleaneo_biometric_declined', userSpecific: false }, // LoginView (refus biométrie)
  { key: 'ocleaneo_notifications_enabled', userSpecific: false }, // notifications.ts (rappels)

  // --- Réglages globaux (conservés au logout) ---
  { key: 'ocleaneo_api_base_url', userSpecific: false }, // RestProvider (restClient.ts)
  { key: 'ocleaneo_odoo_api_base_url', userSpecific: false }, // OdooProvider (odooClient.ts)
  { key: 'ocleaneo_data_provider', userSpecific: false }, // providers/index.ts
  { key: 'ocleaneo_trace_mode_enabled', userSpecific: false }, // errorLog.ts
  { key: 'ocleaneo_error_log', userSpecific: false }, // journal de bord technique (diagnostic inter-sessions)
];

/**
 * Faux positifs du scan d'exhaustivité : littéraux `ocleaneo_*` du code qui
 * ne sont PAS des clés de stockage persistant. `ocleaneo_tag_commissioning`
 * est le technical_name d'un feature flag backend (mock + isModuleActive),
 * `ocleaneo_token` vit dans le Keychain natif via le plugin biométrique
 * (tokenStore.ts) — effacée au logout par clearToken(), pas par
 * clearUserPreferences() qui ne parcourt que @capacitor/preferences.
 */
const NON_STORAGE_LITERALS = new Set(['ocleaneo_tag_commissioning', 'ocleaneo_token']);

export { NON_STORAGE_LITERALS };

const USER_SPECIFIC_PREFIXES = STORED_KEYS.filter(
  (k) => k.userSpecific && k.prefix,
).map((k) => k.key);
const USER_SPECIFIC_EXACT = new Set(
  STORED_KEYS.filter((k) => k.userSpecific && !k.prefix).map((k) => k.key),
);
const GLOBAL_EXACT = new Set(
  STORED_KEYS.filter((k) => !k.userSpecific).map((k) => k.key),
);

/**
 * Efface toutes les données locales liées à l'utilisateur connecté.
 *
 * Appelée depuis auth.logout() et depuis l'écran Profil à chaque déconnexion
 * explicite. Elle ne touche pas aux paramètres globaux ni au choix de backend.
 */
export async function clearUserPreferences(): Promise<void> {
  const { keys } = await Preferences.keys().catch(() => ({ keys: [] as string[] }));
  for (const key of keys) {
    if (GLOBAL_EXACT.has(key)) continue;
    if (USER_SPECIFIC_EXACT.has(key) || USER_SPECIFIC_PREFIXES.some((prefix) => key.startsWith(prefix))) {
      await Preferences.remove({ key }).catch(() => {});
    }
  }
}

/**
 * Réinitialise complètement l'état utilisateur : caches, files, notifications,
 * identifiants biométriques.
 *
 * Contrairement à un simple `$reset()` des stores, cette fonction efface aussi
 * le stockage persistant. Les stores sont réinitialisés par l'appelant pour
 * éviter une dépendance circulaire (auth.logout() est appelé depuis le store
 * auth lui-même).
 */
export async function clearAllUserData(): Promise<void> {
  await Promise.all([
    clearUserPreferences(),
    clearSavedCredentials().catch(() => {}),
    cancelAllNotifications().catch(() => {}),
  ]);
}