import { Capacitor } from '@capacitor/core';
import { NFC } from '@exxili/capacitor-nfc';

export async function isNfcSupported() {
  if (!Capacitor.isNativePlatform()) return false;
  try {
    const { supported } = await NFC.isSupported();
    return supported;
  } catch {
    return false;
  }
}

/**
 * Sur iOS, lire un badge exige d'ouvrir explicitement une session NFC suite à un
 * geste de l'utilisateur (contrainte Apple) : appelée par le bouton de l'écran
 * Pointage. Sur Android, la lecture est automatique dès que l'app est au premier
 * plan (voir stores/pointage.js) — appeler startScan() y échoue systématiquement
 * ("Android NFC scanning does not require 'startScan' method"), donc on ne
 * l'appelle que sur iOS.
 */
export async function startIosNfcSession() {
  if (Capacitor.getPlatform() !== 'ios') return;
  await NFC.startScan();
}

export function cancelIosNfcSession() {
  if (Capacitor.getPlatform() !== 'ios') return;
  NFC.cancelScan().catch(() => {});
}
