import { Capacitor } from '@capacitor/core';
import { AccessControl, NativeBiometric } from '@capgo/capacitor-native-biometric';
import { recordError } from './errorLog';

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
 * consécutif.
 *
 * `authValidityDuration` évite un vrai bug d'appareil confirmé sur le
 * terrain (journal d'erreur : "Failed to encrypt credentials: null", une
 * NullPointerException) : sans lui, le chiffrement est lié à l'objet
 * `Cipher` que le `BiometricPrompt` est censé renvoyer après succès —
 * exactement le round-trip que l'implémentation biométrique propriétaire
 * de certains appareils (constructeurs avec leur propre interface
 * d'empreinte plutôt que le dialogue système standard) ne respecte pas :
 * le `Cipher` revient `null` malgré une empreinte acceptée. Une valeur non
 * nulle bascule le plugin sur un mode différent (voir AuthActivity.java,
 * "validity-window mode") : la clé Keystore reste utilisable sans nouvelle
 * empreinte pendant cette fenêtre, donc le chiffrement s'exécute directement
 * après le succès du prompt, sans dépendre de ce retour. Une fenêtre courte
 * (secondes) n'affaiblit pas la protection en pratique : l'écriture se fait
 * immédiatement après le prompt, la fenêtre est close bien avant qu'elle ne
 * puisse être exploitée pour un accès ultérieur non biométrique.
 */
export async function saveCredentials(username: string, password: string): Promise<boolean> {
  if (!isNative()) return false;
  try {
    await NativeBiometric.setCredentials({
      server: SERVER,
      username,
      password,
      accessControl: AccessControl.BIOMETRY_ANY,
      authValidityDuration: 10,
    });
    return true;
  } catch (e) {
    // Le stockage biométrique est une commodité : une erreur ne doit pas
    // bloquer la connexion. Retourner false pour que l'appelant sache.
    //
    // Cette erreur était jusqu'ici avalée sans trace : le toast montré à
    // l'utilisateur ("Impossible d'activer...") ne dit que l'échec, jamais
    // pourquoi — côté natif, AuthActivity (mode setSecureCredentials)
    // rejette avec un errorCode/errorDetails précis qu'on perdait
    // totalement. Consigné dans le journal local (services/errorLog.ts,
    // déjà partageable depuis le profil) pour diagnostiquer sur preuve un
    // éventuel prochain échec, plutôt que sur une nouvelle hypothèse.
    void recordError(e, 'biometric.saveCredentials');
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
