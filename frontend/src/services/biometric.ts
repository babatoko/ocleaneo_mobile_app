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

export async function saveCredentials(username: string, password: string): Promise<void> {
  if (!isNative()) return;
  try {
    await NativeBiometric.setCredentials({
      server: SERVER,
      username,
      password,
      accessControl: AccessControl.BIOMETRY_ANY,
    });
  } catch {
    // Le stockage biométrique est une commodité : une erreur ne doit pas bloquer la connexion.
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
