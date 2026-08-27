import { describe, expect, it, vi } from 'vitest';
import {
  DataProvider,
  ProviderUnsupportedError,
  UNSUPPORTED_MESSAGES,
} from '../DataProvider';
import type { ProviderFeature } from '../DataProvider';

vi.mock('../odooClient', () => ({
  odooClient: { post: vi.fn() },
  DEFAULT_ODOO_BASE_URL: 'http://x/api/mobile',
  getOdooBaseUrl: () => 'http://x/api/mobile',
  initOdooBaseUrl: vi.fn(),
  setOdooBaseUrl: vi.fn(),
}));

const { OdooProvider } = await import('../OdooProvider');

// Ces tests verrouillent la déclaration de capacités du contrat provider.
// Sans elle, les trois onglets sans route Odoo (catalogue, inventaire,
// commandes) affichaient un spinner puis le nom de la méthode manquante —
// du jargon de développeur devant un agent d'entretien. Les écrans
// interrogent maintenant supports() *avant* d'appeler ; si un provider
// cessait de déclarer ce qu'il ne couvre pas, on y reviendrait.

const ALL_FEATURES: ProviderFeature[] = ['products', 'inventory', 'orders'];

describe('déclaration de capacités', () => {
  it('suppose tout supporté par défaut : au provider incomplet de se signaler', () => {
    class Bare extends DataProvider {}
    const bare = new Bare();
    for (const f of ALL_FEATURES) expect(bare.supports(f)).toBe(true);
  });

  it("le provider Odoo déclare les trois domaines sans route, et rien d'autre", () => {
    const odoo = new OdooProvider();
    for (const f of ALL_FEATURES) expect(odoo.supports(f)).toBe(false);
    // Le planning et le pointage, eux, doivent rester intouchés : c'est
    // tout l'intérêt de dégrader onglet par onglet plutôt qu'en bloc.
    expect(odoo.supports('planning' as ProviderFeature)).toBe(true);
  });

  it('a un message lisible par un salarié pour chaque domaine déclarable', () => {
    for (const f of ALL_FEATURES) {
      const msg = UNSUPPORTED_MESSAGES[f];
      expect(msg).toBeTruthy();
      // Un message qui nomme une méthode du contrat n'apprend rien à
      // quelqu'un sur le terrain.
      expect(msg).not.toMatch(/fetch|Provider|\(\)/);
    }
  });
});

describe('filet de sécurité : appel malgré une capacité absente', () => {
  it('lève une ProviderUnsupportedError, pas une panne réseau', async () => {
    const odoo = new OdooProvider();
    const err = await odoo.fetchMyOrders().catch((e) => e);
    expect(err).toBeInstanceOf(ProviderUnsupportedError);
    expect(err.isUnsupported).toBe(true);
    // Distinguer des deux autres familles d'erreur : un écran qui confond
    // les trois proposerait « Réessayer » là où réessayer ne peut rien.
    expect(err.isNetworkError).toBeUndefined();
    expect(err.status).toBeUndefined();
  });

  it("garde le nom de la méthode pour les logs, hors du message affiché", async () => {
    const odoo = new OdooProvider();
    const err = await odoo.fetchProducts().catch((e) => e);
    expect(err.method).toBe('fetchProducts');
    expect(err.message).not.toContain('fetchProducts');
  });
});
