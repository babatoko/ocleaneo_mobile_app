import { Capacitor, registerPlugin } from '@capacitor/core';
import { NFC } from '@exxili/capacitor-nfc';

export async function isNfcSupported(): Promise<boolean> {
  if (!Capacitor.isNativePlatform()) return false;
  try {
    const { supported } = await NFC.isSupported();
    return supported;
  } catch {
    return false;
  }
}

/**
 * @exxili/capacitor-nfc (isSupported ci-dessus) sait dire si l'appareil
 * POSSÈDE une puce NFC, mais pas si le NFC est ACTIVÉ dans les réglages —
 * la seule information qui distingue, côté écran Pointage, "aucun badge
 * présenté" de "NFC éteint, rien ne sera jamais lu". Aucun plugin tiers ne
 * l'expose : NfcStatus est un petit plugin natif maison
 * (android/app/.../NfcStatusPlugin.java), Android uniquement — iOS n'a pas
 * d'équivalent d'un NFC système désactivable (Core NFC est disponible dès
 * lors que l'appareil le supporte).
 */
interface NfcStatusPlugin {
  isEnabled(): Promise<{ supported: boolean; enabled: boolean }>;
  openSettings(): Promise<void>;
}

const NfcStatus = registerPlugin<NfcStatusPlugin>('NfcStatus');

/** `null` : impossible à déterminer sur cette plateforme (iOS, web). */
export async function isNfcEnabled(): Promise<boolean | null> {
  if (Capacitor.getPlatform() !== 'android') return null;
  try {
    const { enabled } = await NfcStatus.isEnabled();
    return enabled;
  } catch {
    return null;
  }
}

/** Ouvre l'écran de réglages NFC d'Android. No-op silencieux ailleurs. */
export async function openNfcSettings(): Promise<void> {
  if (Capacitor.getPlatform() !== 'android') return;
  await NfcStatus.openSettings().catch(() => {});
}

/**
 * Sur iOS, lire un badge exige d'ouvrir explicitement une session NFC suite à un
 * geste de l'utilisateur (contrainte Apple) : appelée par le bouton de l'écran
 * Pointage. Sur Android, la lecture est automatique dès que l'app est au premier
 * plan (voir stores/pointage.ts) — appeler startScan() y échoue systématiquement
 * ("Android NFC scanning does not require 'startScan' method"), donc on ne
 * l'appelle que sur iOS.
 */
export async function startIosNfcSession(): Promise<void> {
  if (Capacitor.getPlatform() !== 'ios') return;
  await NFC.startScan();
}

export function cancelIosNfcSession(): void {
  if (Capacitor.getPlatform() !== 'ios') return;
  NFC.cancelScan().catch(() => {});
}
