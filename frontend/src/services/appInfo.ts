import { App } from '@capacitor/app';

/**
 * Identifie la version installée sans passer par Android Studio ni gradle —
 * utile au salarié pour confirmer "j'ai bien la dernière version" et à qui
 * dépanne pour vérifier qu'un correctif signalé est bien arrivé sur le
 * téléphone en question (voir errorLog.ts : même logique, rendre l'état de
 * l'app observable plutôt que deviné à distance).
 *
 * Sur natif, App.getInfo().version est le versionName réel de l'APK — la
 * date de build (voir android/app/build.gradle), donc la source de vérité.
 * En PWA/navigateur, ce plugin n'est pas implémenté : on retombe sur
 * __APP_BUILD_DATE__, la même date injectée par Vite à la compilation
 * (vite.config.ts), dans le même format — le repli reste comparable à la
 * valeur native plutôt que de basculer sur un format différent.
 */
declare const __APP_BUILD_DATE__: string;

let cache: string | null = null;

export async function getAppVersion(): Promise<string> {
  if (cache) return cache;
  try {
    const info = await App.getInfo();
    cache = info.version;
  } catch {
    cache = typeof __APP_BUILD_DATE__ !== 'undefined' ? __APP_BUILD_DATE__ : 'dev';
  }
  return cache;
}
