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
 * biométrie (AccessControl.BIOMETRY_ANY). Le plugin EXIGE une authentification
 * biométrique immédiate au moment de l'écriture : sans prompt préalable, il
 * jette une erreur ("User not authenticated") qu'on avalait silencieusement,
 * et la sauvegarde n'avait jamais lieu — d'où le retour systématique à
 * l'écran mot de passe au prochain lancement, malgré l'acceptation de
 * l'invite. On demande donc d'abord l'empreinte, puis on écrit ; si le
 * salarié annule le prompt ou si le capteur échoue, on ne sauvegarde rien.
 */
export async function saveCredentials(username: string, password: string): Promise<boolean> {
  if (!isNative()) return false;
  try {
    await NativeBiometric.verifyIdentity({
      reason: "Confirmez votre identité pour activer la connexion par empreinte",
      title: "Enregistrer l'empreinte",
      subtitle: "La prochaine fois, vous vous connecterez avec votre doigt.",
      description: "",
    });
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
