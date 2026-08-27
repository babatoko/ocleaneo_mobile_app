import { Capacitor } from '@capacitor/core';
import { NativeBiometric } from '@capgo/capacitor-native-biometric';

/**
 * Dépôt unique du jeton d'authentification.
 *
 * Constat F-07 de l'audit : le jeton vivait dans `localStorage`. Sur mobile,
 * c'est le stockage de la WebView — un fichier en clair dans le bac à sable de
 * l'application. Il survit à une sauvegarde de l'appareil, se lit sur un
 * téléphone rooté ou débloqué, et n'est protégé par rien d'autre que les
 * permissions de fichiers. Or ce jeton donne accès au planning, aux chantiers
 * et aux pointages d'un salarié.
 *
 * Sur natif il est désormais confié au Trousseau (iOS) / Keystore (Android)
 * via `NativeBiometric.setData`, qui chiffre au repos. Le plugin est déjà une
 * dépendance du projet (services/biometric.ts s'en sert pour la connexion
 * biométrique) : aucune dépendance nouvelle, aucun build natif à revoir.
 *
 * DÉLIBÉRÉMENT SANS `accessControl` : le jeton doit se relire au démarrage
 * sans demander une empreinte. Poser une protection biométrique dessus ferait
 * apparaître une invite à chaque lancement, y compris pour un salarié qui n'a
 * pas activé la biométrie — et l'empreinte garde sa place là où elle a du
 * sens, sur le mot de passe (services/biometric.ts). On chiffre au repos, on
 * n'ajoute pas une porte devant l'application.
 *
 * EN PWA, `localStorage` reste le seul stockage disponible : un navigateur
 * n'expose ni Trousseau ni Keystore. La limite est réelle et assumée — c'est
 * le prix de l'installation sans store. Elle est documentée dans le README.
 */

const TOKEN_KEY = 'ocleaneo_token';

/**
 * Cache mémoire, et raison d'être de ce module.
 *
 * Les intercepteurs axios (providers/restClient.ts, providers/odooClient.ts)
 * posent l'en-tête Authorization de façon SYNCHRONE — ils ne peuvent pas
 * attendre une promesse. Le stockage sécurisé, lui, est asynchrone. On lit
 * donc une fois au démarrage (loadToken, appelé depuis main.ts avant le
 * premier appel réseau) et les intercepteurs se servent ici.
 */
let cached: string | null = null;
let loaded = false;

function isNative(): boolean {
  return Capacitor.isNativePlatform();
}

/** Le jeton courant, sans attente. Renvoie null tant que loadToken() n'a pas
 *  été appelé — d'où son appel avant tout le reste dans main.ts. */
export function currentToken(): string | null {
  return cached;
}

/** Vrai une fois l'hydratation faite. Sert aux tests et au diagnostic. */
export function isTokenLoaded(): boolean {
  return loaded;
}

async function readSecure(): Promise<string | null> {
  try {
    const { value } = await NativeBiometric.getData({ key: TOKEN_KEY });
    return value || null;
  } catch {
    // Rien de stocké, ou plateforme sans stockage sécurisé : les deux se
    // traitent pareil — pas de jeton.
    return null;
  }
}

/**
 * Hydrate le cache depuis le stockage. À appeler UNE FOIS au démarrage, avant
 * le premier appel réseau (voir main.ts).
 *
 * Aucune reprise d'un jeton laissé en clair par une version précédente :
 * l'application n'est pas déployée, il n'existe donc aucun appareil portant
 * un tel jeton. Le code de migration serait du poids mort dès le premier
 * jour, à charge d'un lecteur futur qui chercherait quel parc il protège.
 */
export async function loadToken(): Promise<string | null> {
  cached = isNative() ? await readSecure() : safeLocalGet();
  loaded = true;
  return cached;
}

async function writeSecure(token: string): Promise<void> {
  await NativeBiometric.setData({ key: TOKEN_KEY, value: token });
}

export async function saveToken(token: string): Promise<void> {
  // Le cache d'abord : une écriture disque lente ne doit pas retarder la
  // première requête authentifiée qui suit la connexion.
  cached = token;
  loaded = true;
  if (isNative()) {
    await writeSecure(token);
  } else {
    safeLocalSet(token);
  }
}

export async function clearToken(): Promise<void> {
  // Le cache d'abord : dès cette ligne, plus aucune requête ne part signée,
  // sans attendre l'effacement disque.
  cached = null;
  loaded = true;
  if (isNative()) {
    try {
      await NativeBiometric.deleteData({ key: TOKEN_KEY });
    } catch {
      // Rien à supprimer.
    }
  } else {
    safeLocalRemove();
  }
}

/* `localStorage` peut lever (mode privé Safari, quota, contexte sans DOM
 * comme la suite de tests) ; aucune de ces pannes ne doit empêcher
 * l'application de démarrer. */
function safeLocalGet(): string | null {
  try {
    return localStorage.getItem(TOKEN_KEY);
  } catch {
    return null;
  }
}

function safeLocalSet(token: string): void {
  try {
    localStorage.setItem(TOKEN_KEY, token);
  } catch {
    /* Le cache mémoire prend le relais pour la session en cours. */
  }
}

function safeLocalRemove(): void {
  try {
    localStorage.removeItem(TOKEN_KEY);
  } catch {
    /* Rien à faire. */
  }
}
