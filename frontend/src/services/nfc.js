import { Capacitor } from '@capacitor/core';
import { NFC } from '@exxili/capacitor-nfc';

function isNative() {
  return Capacitor.isNativePlatform();
}

export async function isNfcSupported() {
  if (!isNative()) return false;
  try {
    const { supported } = await NFC.isSupported();
    return supported;
  } catch {
    return false;
  }
}

/**
 * Démarre une session de lecture NFC et résout avec l'identifiant (UID) du
 * premier badge lu. Se termine sur le premier tag lu, la première erreur,
 * ou après `timeoutMs` sans lecture.
 */
export function scanNfcTag(timeoutMs = 30000) {
  return new Promise((resolve, reject) => {
    let settled = false;
    let unsubRead;
    let unsubError;
    let timer;

    const cleanup = () => {
      clearTimeout(timer);
      unsubRead?.();
      unsubError?.();
      NFC.cancelScan().catch(() => {});
    };

    const settle = (fn, arg) => {
      if (settled) return;
      settled = true;
      cleanup();
      fn(arg);
    };

    unsubRead = NFC.onRead((data) => {
      const uid = data.string()?.tagInfo?.uid;
      if (uid) settle(resolve, uid);
      else settle(reject, new Error('Badge lu mais sans identifiant exploitable.'));
    });

    unsubError = NFC.onError((err) => {
      settle(reject, new Error(err.error || 'Erreur de lecture NFC.'));
    });

    timer = setTimeout(() => settle(reject, new Error('Aucun badge détecté.')), timeoutMs);

    NFC.startScan().catch((e) => settle(reject, e));
  });
}
