import { describe, expect, it, vi, beforeEach } from 'vitest';

/**
 * Un salarié devait forcer l'arrêt de l'App puis vider le cache pour
 * bénéficier d'une mise à jour : le service worker de la PWA (Workbox,
 * enregistré par vite-plugin-pwa) s'enregistrait aussi dans la coquille
 * native, où Android ne vide pas le stockage web de la WebView à
 * l'installation d'une nouvelle version d'APK — le service worker restait
 * actif d'une version à l'autre et continuait à servir les fichiers de
 * l'ancienne. Ces tests verrouillent qu'il ne s'enregistre plus sur natif,
 * et que tout enregistrement laissé par un APK d'avant ce correctif est
 * purgé automatiquement, sans action de l'utilisateur.
 */

let native = false;
const unregister = vi.fn(async () => {});
const registrations: { unregister: () => Promise<void> }[] = [];
const registerSW = vi.fn();

vi.mock('@capacitor/core', () => ({
  Capacitor: { isNativePlatform: () => native },
}));

vi.mock('virtual:pwa-register', () => ({
  registerSW: (...args: unknown[]) => registerSW(...args),
}));

beforeEach(() => {
  native = false;
  unregister.mockClear();
  registerSW.mockClear();
  registrations.length = 0;
  vi.stubGlobal('navigator', {
    serviceWorker: { getRegistrations: async () => registrations },
  });
  vi.stubGlobal('caches', { keys: async () => [], delete: vi.fn(async () => true) });
});

async function setupServiceWorker() {
  const mod = await import('../pwaUpdate');
  return mod.setupServiceWorker();
}

describe('setupServiceWorker', () => {
  it('enregistre le service worker en PWA (web)', async () => {
    native = false;
    await setupServiceWorker();
    expect(registerSW).toHaveBeenCalledWith({ immediate: true });
  });

  it('ne s\'enregistre pas sur natif', async () => {
    native = true;
    await setupServiceWorker();
    expect(registerSW).not.toHaveBeenCalled();
  });

  it("purge un enregistrement laissé par un APK d'avant ce correctif", async () => {
    native = true;
    registrations.push({ unregister });
    registrations.push({ unregister });

    await setupServiceWorker();

    expect(unregister).toHaveBeenCalledTimes(2);
  });

  it('purge aussi les caches Workbox laissés par une version précédente', async () => {
    native = true;
    const deleteCache = vi.fn(async () => true);
    vi.stubGlobal('caches', { keys: async () => ['workbox-precache-v2', 'workbox-runtime'], delete: deleteCache });

    await setupServiceWorker();

    expect(deleteCache).toHaveBeenCalledWith('workbox-precache-v2');
    expect(deleteCache).toHaveBeenCalledWith('workbox-runtime');
  });

  it("ne fait pas échouer le démarrage si la purge lève une erreur", async () => {
    native = true;
    vi.stubGlobal('navigator', {
      serviceWorker: {
        getRegistrations: async () => {
          throw new Error('indisponible');
        },
      },
    });

    await expect(setupServiceWorker()).resolves.toBeUndefined();
  });
});
