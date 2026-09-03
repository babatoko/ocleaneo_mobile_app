import { Capacitor } from '@capacitor/core';

/**
 * Le service worker (Workbox, voir vite.config.ts) précache les fichiers
 * pour un usage web hors ligne — inutile sur natif, où l'App livre déjà des
 * fichiers frais à chaque APK. L'y enregistrer quand même posait un cache
 * qui SURVIT à une mise à jour d'APK : Android remplace les fichiers
 * embarqués à l'installation, mais ne vide pas le stockage web de la
 * WebView (Cache Storage, service worker enregistré) — ce dernier reste
 * actif d'une version à l'autre et continuait donc à servir les fichiers de
 * l'ancienne version. Seuls un arrêt forcé puis un vidage du cache manuel
 * suffisaient à en sortir, ce qu'un salarié n'a aucune raison de deviner.
 *
 * En PWA (navigateur), c'est l'inverse : le service worker est le seul
 * moyen de fonctionner hors ligne et de proposer l'installation sur écran
 * d'accueil (voir README § PWA) — il reste donc enregistré normalement.
 */
export async function setupServiceWorker(): Promise<void> {
  if (Capacitor.isNativePlatform()) {
    await disableServiceWorker();
    return;
  }
  const { registerSW } = await import('virtual:pwa-register');
  registerSW({ immediate: true });
}

/** Purge tout ce qu'un APK d'avant ce correctif aurait pu laisser
 *  enregistré, pour que l'utilisateur n'ait plus jamais à le faire à la
 *  main. Sans effet si rien n'a jamais été enregistré. */
async function disableServiceWorker(): Promise<void> {
  try {
    if ('serviceWorker' in navigator) {
      const registrations = await navigator.serviceWorker.getRegistrations();
      await Promise.all(registrations.map((r) => r.unregister()));
    }
    // globalThis, pas window : ce module tourne aussi bien dans le
    // navigateur (où les deux coïncident) que dans les tests (environnement
    // Node, où `window` n'existe pas).
    if ('caches' in globalThis) {
      const keys = await globalThis.caches.keys();
      // Uniquement les caches Workbox ("workbox-precache-...", etc.) — ceux
      // qu'un ancien APK aurait laissés. Cette fonction tourne à CHAQUE
      // démarrage natif (main.ts), pas une seule fois : un filtre trop large
      // (tout `caches.keys()`, comme avant) viderait aussi bien tout autre
      // cache applicatif créé depuis — ocleaneo-map-tiles (tileCache.ts),
      // dont tout l'intérêt est justement de survivre d'un lancement à
      // l'autre — à chaque relance de l'App, avant même d'avoir pu servir
      // une seule fois hors ligne.
      await Promise.all(
        keys.filter((k) => k.startsWith('workbox-')).map((k) => globalThis.caches.delete(k)),
      );
    }
  } catch {
    // Au pire, l'ancien service worker reste actif une fois de plus — pas
    // une raison de bloquer le démarrage de l'App pour autant.
  }
}
