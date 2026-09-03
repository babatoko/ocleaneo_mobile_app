import { describe, expect, it, vi } from 'vitest';

/**
 * Un jeton rejeté en cours de session (code 401, forme "métier" — voir la
 * docstring de callMobile() dans OdooProvider.ts) ne mettait à jour que le
 * dépôt de jeton (services/tokenStore.ts) : le store d'authentification,
 * déjà chargé, restait persuadé d'être connecté et l'agent bloquait sur son
 * écran avec des appels qui échouaient en boucle, un message technique
 * ("unauthorized") sans jamais revenir à l'écran de connexion. callMobile()
 * doit désormais aussi signaler l'expiration via services/sessionEvents.ts,
 * que main.ts écoute pour déconnecter et rediriger.
 */

vi.mock('../odooClient', () => ({
  odooClient: { post: vi.fn() },
  ODOO_API_VERSION: 'v1',
  DEFAULT_ODOO_BASE_URL: 'http://x/api/mobile',
  getOdooBaseUrl: () => 'http://x/api/mobile',
  initOdooBaseUrl: vi.fn(),
  setOdooBaseUrl: vi.fn(),
}));

vi.mock('@capacitor/preferences', () => ({
  Preferences: { get: async () => ({ value: null }), set: async () => {} },
}));

const clearToken = vi.fn(async () => {});
vi.mock('../../services/tokenStore', () => ({
  clearToken: () => clearToken(),
}));

const emitSessionExpired = vi.fn();
vi.mock('../../services/sessionEvents', () => ({
  emitSessionExpired: () => emitSessionExpired(),
}));

const { odooClient } = await import('../odooClient');
const { OdooProvider } = await import('../OdooProvider');
const { ProviderError } = await import('../DataProvider');

const post = vi.mocked(odooClient.post);

describe('OdooProvider — jeton rejeté en cours de session', () => {
  it("vide le dépôt de jeton ET signale l'expiration sur une erreur métier 401", async () => {
    post.mockResolvedValueOnce({
      status: 200,
      data: { jsonrpc: '2.0', id: 1, result: { error: 'unauthorized', code: 401 } },
    } as never);

    const err = await new OdooProvider().fetchMe().catch((e) => e);

    expect(err).toBeInstanceOf(ProviderError);
    expect(clearToken).toHaveBeenCalledTimes(1);
    expect(emitSessionExpired).toHaveBeenCalledTimes(1);
  });

  it("ne signale rien sur une erreur métier qui n'est pas 401", async () => {
    clearToken.mockClear();
    emitSessionExpired.mockClear();
    post.mockResolvedValueOnce({
      status: 200,
      data: { jsonrpc: '2.0', id: 1, result: { error: 'no employee linked to user', code: 400 } },
    } as never);

    await new OdooProvider().fetchMe().catch((e) => e);

    expect(clearToken).not.toHaveBeenCalled();
    expect(emitSessionExpired).not.toHaveBeenCalled();
  });
});
