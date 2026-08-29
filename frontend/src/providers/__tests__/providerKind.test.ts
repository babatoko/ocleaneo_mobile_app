import { describe, expect, it, vi, beforeEach } from 'vitest';

/**
 * setProviderKind() est le mécanisme qui permet de choisir odoo/rest/mock
 * depuis l'app (LoginView.vue/ProfileView.vue), sans reconstruire — jusqu'ici
 * VITE_DATA_PROVIDER était figé au build (voir .env.example) et il n'existait
 * aucun moyen de le corriger depuis un build déjà installé. Un mock
 * volontairement asynchrone : le vrai @capacitor/preferences l'est aussi
 * (voir services/__tests__/offlineQueue.test.ts).
 */

let store: Record<string, string> = {};
const tick = () => new Promise((r) => setTimeout(r, 0));

vi.mock('@capacitor/preferences', () => ({
  Preferences: {
    get: async ({ key }: { key: string }) => {
      await tick();
      return { value: store[key] ?? null };
    },
    set: async ({ key, value }: { key: string; value: string }) => {
      await tick();
      store[key] = value;
    },
  },
}));

// `provider` est réassigné par setProviderKind() (voir providers/index.ts) :
// le destructurer capturerait sa valeur une fois pour toutes, donc on passe
// par le namespace du module pour lire `.provider` à chaque assertion.
const providers = await import('../index');
const { providerKind, initProvider, setProviderKind, DEFAULT_PROVIDER_KIND } = providers;
const { RestProvider } = await import('../RestProvider');
const { OdooProvider } = await import('../OdooProvider');
const { MockProvider } = await import('../MockProvider');

describe('providers/index — sélection du backend à l\'exécution', () => {
  beforeEach(() => {
    store = {};
  });

  it("VITE_DATA_PROVIDER n'étant pas positionné en test, retombe sur 'odoo' — le seul backend réellement implémenté", () => {
    // 'rest' n'a jamais eu d'instance de production en face (voir README §
    // Intégration Odoo) ; un build sans VITE_DATA_PROVIDER explicite doit
    // donc retomber sur 'odoo', pas sur ce chemin mort.
    expect(DEFAULT_PROVIDER_KIND).toBe('odoo');
    expect(providers.provider).toBeInstanceOf(OdooProvider);
  });

  it("bascule vers rest si on lui demande explicitement, ce qui reste un choix valide", async () => {
    await setProviderKind('rest');
    expect(providerKind.value).toBe('rest');
    expect(providers.provider).toBeInstanceOf(RestProvider);
  });

  it('setProviderKind bascule vers odoo et met à jour la ref réactive providerKind', async () => {
    await setProviderKind('odoo');
    expect(providerKind.value).toBe('odoo');
    expect(providers.provider).toBeInstanceOf(OdooProvider);
  });

  it('setProviderKind persiste le choix (@capacitor/preferences)', async () => {
    await setProviderKind('odoo');
    expect(store['ocleaneo_data_provider']).toBe('odoo');
  });

  it('initProvider relit le choix persisté et recrée le bon provider concret', async () => {
    store['ocleaneo_data_provider'] = 'mock';
    await initProvider();
    expect(providerKind.value).toBe('mock');
    expect(providers.provider).toBeInstanceOf(MockProvider);
  });

  it('initProvider ignore une valeur persistée invalide et garde le backend courant', async () => {
    await setProviderKind('odoo'); // état courant = odoo
    store['ocleaneo_data_provider'] = 'ftp-au-hasard'; // corruption simulée du stockage
    await initProvider();
    expect(providerKind.value).toBe('odoo'); // inchangé : la valeur stockée est rejetée
  });
});
