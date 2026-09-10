import { Preferences } from '@capacitor/preferences';
import { cancelAllNotifications } from './notifications';
import { clearSavedCredentials } from './biometric';

/**
 * Clés persistantes spécifiques à l'utilisateur courant. Elles doivent être
 * effacées à la déconnexion pour qu'un autre salarié qui se connecte sur le
 * même appareil ne voie jamais les données du précédent.
 */
const USER_SPECIFIC_KEY_PREFIXES = [
  'ocleaneo_shifts_',           // caches du planning (jour, semaine, mois, upcoming)
  'ocleaneo_chantiers_cache',  // liste des chantiers du salarié
  'ocleaneo_pointage_pending_compte_rendu',
  'ocleaneo_pointage_offline_queue',
  'ocleaneo_pointage_failed_entries',
  'ocleaneo_tour_seen_',        // état du tour guidé par employé
];

/**
 * Clés globales de l'application qu'on veut conserver entre deux sessions :
 * URL serveur, choix de backend, version, mode traçage, journal d'erreurs.
 */
const GLOBAL_KEYS = new Set([
  'ocleaneo_server_url',
  'ocleaneo_data_provider',
  'ocleaneo_trace_mode',
  'ocleaneo_error_log',
]);

/**
 * Efface toutes les données locales liées à l'utilisateur connecté.
 *
 * Appelée depuis auth.logout() et depuis l'écran Profil à chaque déconnexion
 * explicite. Elle ne touche pas aux paramètres globaux ni au choix de backend.
 */
export async function clearUserPreferences(): Promise<void> {
  const { keys } = await Preferences.keys().catch(() => ({ keys: [] as string[] }));
  for (const key of keys) {
    if (GLOBAL_KEYS.has(key)) continue;
    if (USER_SPECIFIC_KEY_PREFIXES.some((prefix) => key.startsWith(prefix))) {
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
