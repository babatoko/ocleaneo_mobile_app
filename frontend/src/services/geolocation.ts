import { Geolocation } from '@capacitor/geolocation';
import type { Position } from '../types/models';

/**
 * Récupère la position GPS via le plugin natif Capacitor si possible,
 * sinon fallback sur l'API navigateur (dev web/PWA).
 * En cas d'erreur ou de permission refusée, retourne null sans bloquer
 * le pointage — l'app affiche un avertissement et envoie quand même.
 */
export async function getCurrentLocation(): Promise<Position | null> {
  try {
    // 1. Vérifier la permission native (Android 10+ exige une demande explicite)
    const perm = await Geolocation.checkPermissions();
    if (perm.location !== 'granted') {
      const req = await Geolocation.requestPermissions();
      if (req.location !== 'granted') {
        return fallbackBrowserPosition();
      }
    }

    // 2. Position native (plus fiable dans le WebView Android)
    const pos = await Geolocation.getCurrentPosition({
      enableHighAccuracy: true,
      timeout: 5000,
    });
    return {
      latitude: pos.coords.latitude,
      longitude: pos.coords.longitude,
    };
  } catch (err) {
    // Plugin non disponible, permissions refusées, ou erreur native :
    // on tente le fallback navigateur avant d'abandonner.
    return fallbackBrowserPosition();
  }
}

function fallbackBrowserPosition(): Promise<Position | null> {
  return new Promise((resolve) => {
    if (!navigator.geolocation) return resolve(null);
    navigator.geolocation.getCurrentPosition(
      (pos) =>
        resolve({
          latitude: pos.coords.latitude,
          longitude: pos.coords.longitude,
        }),
      () => resolve(null),
      { enableHighAccuracy: true, timeout: 3000, maximumAge: 30000 }
    );
  });
}
