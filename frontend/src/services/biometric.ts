import { Capacitor } from '@capacitor/core';
import { AccessControl, NativeBiometric } from '@capgo/capacitor-native-biometric';

const SERVER = 'ocleaneo-mobile';

function isNative(): boolean {
  return Capacitor.isNativePlatform();
}

export async function isBiometricAvailable(): Promise<boolean> {
  if (!isNative()) return false;
  try {
    const { isAvailable } = await NativeBiometric.isAvailable();
    return isAvailable;
  } catch {
    return false;
  }
}

export async function hasSavedCredentials(): Promise<boolean> {
  if (!isNative()) return false;
  try {
    const { isSaved } = await NativeBiometric.isCredentialsSaved({ server: SERVER });
    return isSaved;
  } catch {
    return false;
  }
}

export async function getSavedCredentials(): Promise<{ username: string; password: string }> {
  const { username, password } = await NativeBiometric.getSecureCredentials({ server: SERVER });
  return { username, password };
}

/**
 * Sauvegarde username/password dans le Keystore Android protégé par
 * biométrie (AccessControl.BIOMETRY_ANY).
 *
 * Un seul appel biométrique : `setCredentials()` avec `accessControl` renseigné
 * lance lui-même, côté natif, sa propre activité d'authentification liée à la
 * clé Keystore créée pour ce stockage (voir AuthActivity.java du plugin,
 * mode "setSecureCredentials") — il ne faut PAS demander une empreinte au
 * préalable via `verifyIdentity()` : c'est une invite biométrique distincte,
 * sans lien avec cette clé, qui ne fait qu'ajouter un deuxième prompt
 * consécutif. Deux `BiometricPrompt` lancés coup sur coup dans deux
 * activités Android séparées est fragile et a fait échouer l'activation sur
 * au moins un appareil dont l'empreinte fonctionne pourtant normalement
 * ailleurs (autres apps).
 */
export async function saveCredentials(username: string, password: string): Promise<boolean> {
  if (!isNative()) return false;
  try {
    await NativeBiometric.setCredentials({
      server: SERVER,
      username,
      password,
      accessControl: AccessControl.BIOMETRY_ANY,
    });
    return true;
  } catch {
    // Le stockage biométrique est une commodité : une erreur ne doit pas
    // bloquer la connexion. Retourner false pour que l'appelant sache.
    return false;
  }
}

export async function clearSavedCredentials(): Promise<void> {
  if (!isNative()) return;
  try {
    await NativeBiometric.deleteCredentials({ server: SERVER });
  } catch {
    // Rien à supprimer, ou plateforme non supportée.
  }
}
