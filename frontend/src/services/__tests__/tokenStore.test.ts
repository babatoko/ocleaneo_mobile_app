import { describe, expect, it, vi, beforeEach } from 'vitest';

/**
 * Constat F-07 de l'audit : le jeton d'authentification vivait dans
 * `localStorage`, c'est-à-dire le stockage de la WebView — un fichier en clair
 * dans le bac à sable de l'application, qui survit à une sauvegarde et se lit
 * sur un téléphone rooté.
 *
 * Ce qui est vérifié ici, et qu'aucune relecture ne garantit :
 *
 * 1. sur natif, le jeton part bien dans le Trousseau/Keystore et PLUS dans
 *    localStorage ;
 * 2. en PWA, où ni Trousseau ni Keystore n'existent, le repli sur
 *    localStorage reste fonctionnel ;
 * 3. une panne du stockage sécurisé fait démarrer l'app déconnectée plutôt
 *    que de la faire échouer au lancement.
 *
 * Aucun test de reprise d'un jeton laissé en clair par une version
 * précédente : l'application n'est pas déployée, ce cas n'existe pas, et le
 * code correspondant a été retiré plutôt que testé.
 */

let native = false;
let keychain: Record<string, string> = {};
let disk: Record<string, string> = {};
let keychainThrowsOnRead = false;

vi.mock('@capacitor/core', () => ({
  Capacitor: { isNativePlatform: () => native },
}));

vi.mock('@capgo/capacitor-native-biometric', () => ({
  NativeBiometric: {
    setData: vi.fn(async ({ key, value }: { key: string; value: string }) => {
      keychain[key] = value;
    }),
    getData: vi.fn(async ({ key }: { key: string }) => {
      // Le plugin rejette quand rien n'est stocké : le simuler, sinon le test
      // ne prouverait rien du chemin d'erreur réel.
      if (keychainThrowsOnRead) throw new Error('secure storage indisponible');
      if (!(key in keychain)) throw new Error('No data found');
      return { value: keychain[key] };
    }),
    deleteData: vi.fn(async ({ key }: { key: string }) => {
      delete keychain[key];
    }),
  },
}));

async function freshModule() {
  // Le cache mémoire est un état de module : il faut le réinitialiser entre
  // deux scénarios, sinon un jeton chargé fuiterait d'un test à l'autre.
  vi.resetModules();
  return import('../tokenStore');
}

beforeEach(() => {
  native = false;
  keychain = {};
  disk = {};
  keychainThrowsOnRead = false;
  vi.stubGlobal('localStorage', {
    getItem: (k: string) => disk[k] ?? null,
    setItem: (k: string, v: string) => {
      disk[k] = v;
    },
    removeItem: (k: string) => {
      delete disk[k];
    },
  });
});

describe('sur mobile (natif)', () => {
  beforeEach(() => {
    native = true;
  });

  it('écrit le jeton dans le stockage sécurisé, jamais en clair', async () => {
    const { saveToken, currentToken } = await freshModule();

    await saveToken('jeton-neuf');

    expect(keychain['ocleaneo_token']).toBe('jeton-neuf');
    // LE point de F-07 : rien ne doit rester dans le stockage de la WebView.
    expect(disk['ocleaneo_token']).toBeUndefined();
    expect(currentToken()).toBe('jeton-neuf');
  });

  it('relit le jeton au démarrage sans demander d’empreinte', async () => {
    keychain['ocleaneo_token'] = 'jeton-de-la-veille';
    const { loadToken, currentToken } = await freshModule();

    // getData (et non getSecureData) : aucune invite biométrique. Une invite
    // à chaque lancement serait insupportable, y compris pour un salarié qui
    // n'a jamais activé la biométrie.
    expect(await loadToken()).toBe('jeton-de-la-veille');
    expect(currentToken()).toBe('jeton-de-la-veille');
  });

  it('ignore un jeton présent en clair', async () => {
    // Sur natif, le stockage sécurisé fait autorité. Rien n'étant déployé, il
    // n'existe aucun appareil portant un jeton en clair à reprendre : lire
    // localStorage ici rouvrirait précisément le trou que F-07 ferme.
    disk['ocleaneo_token'] = 'jeton-en-clair';
    const { loadToken, currentToken } = await freshModule();

    expect(await loadToken()).toBeNull();
    expect(currentToken()).toBeNull();
  });

  it('efface le jeton du stockage sécurisé à la déconnexion', async () => {
    keychain['ocleaneo_token'] = 'jeton';
    const { clearToken, currentToken } = await freshModule();

    await clearToken();

    expect(keychain['ocleaneo_token']).toBeUndefined();
    expect(currentToken()).toBeNull();
  });

  it('démarre sans jeton plutôt que de planter si le stockage est indisponible', async () => {
    keychainThrowsOnRead = true;
    const { loadToken } = await freshModule();

    // Une exception ici empêcherait l'application de démarrer : l'écran de
    // connexion est une bien meilleure issue qu'un écran blanc.
    expect(await loadToken()).toBeNull();
  });
});

describe('en PWA (navigateur)', () => {
  it('retombe sur localStorage, seul stockage disponible', async () => {
    // Un navigateur n'expose ni Trousseau ni Keystore : la limite est réelle
    // et assumée, c'est le prix de l'installation sans store.
    const { saveToken, currentToken } = await freshModule();

    await saveToken('jeton-pwa');

    expect(disk['ocleaneo_token']).toBe('jeton-pwa');
    expect(currentToken()).toBe('jeton-pwa');
  });

  it('relit le jeton au démarrage', async () => {
    disk['ocleaneo_token'] = 'jeton-pwa';
    const { loadToken } = await freshModule();

    expect(await loadToken()).toBe('jeton-pwa');
  });

  it('efface le jeton à la déconnexion', async () => {
    disk['ocleaneo_token'] = 'jeton-pwa';
    const { clearToken, currentToken } = await freshModule();

    await clearToken();

    expect(disk['ocleaneo_token']).toBeUndefined();
    expect(currentToken()).toBeNull();
  });
});

describe('accès synchrone pour les intercepteurs axios', () => {
  it('renvoie null tant que le chargement n’a pas eu lieu', async () => {
    disk['ocleaneo_token'] = 'jeton';
    const { currentToken, isTokenLoaded } = await freshModule();

    // Les intercepteurs posent l'en-tête Authorization de façon synchrone et
    // ne peuvent pas attendre : d'où l'appel à loadToken() dans main.ts AVANT
    // le premier appel réseau. Ce test fige cette dépendance d'ordre.
    expect(isTokenLoaded()).toBe(false);
    expect(currentToken()).toBeNull();
  });

  it('sert le jeton sans attente une fois chargé', async () => {
    disk['ocleaneo_token'] = 'jeton';
    const { loadToken, currentToken, isTokenLoaded } = await freshModule();

    await loadToken();

    expect(isTokenLoaded()).toBe(true);
    expect(currentToken()).toBe('jeton');
  });
});
