import { describe, expect, it, vi, beforeEach } from 'vitest';

/**
 * Même défaut que pour OdooProvider (voir odooSessionExpired.test.ts), côté
 * RestProvider : l'intercepteur de réponse de restClient.ts vidait le dépôt
 * de jeton sur un 401 HTTP sans jamais le signaler au reste de l'app — le
 * store d'authentification restait persuadé d'être connecté.
 */

vi.mock('@capacitor/preferences', () => ({
  Preferences: { get: async () => ({ value: null }), set: async () => {}, remove: async () => {} },
}));

const clearToken = vi.fn(async () => {});
vi.mock('../../services/tokenStore', () => ({
  clearToken: () => clearToken(),
  currentToken: () => null,
}));

const emitSessionExpired = vi.fn();
vi.mock('../../services/sessionEvents', () => ({
  emitSessionExpired: () => emitSessionExpired(),
}));

const { restClient } = await import('../restClient');

function respondWith401(): void {
  restClient.defaults.adapter = async () => {
    throw Object.assign(new Error('Request failed with status code 401'), {
      isAxiosError: true,
      response: { status: 401, data: {}, statusText: 'Unauthorized', headers: {}, config: {} },
    });
  };
}

describe('restClient — jeton rejeté en cours de session', () => {
  beforeEach(() => {
    clearToken.mockClear();
    emitSessionExpired.mockClear();
  });

  it("vide le dépôt de jeton ET signale l'expiration sur un 401 HTTP", async () => {
    respondWith401();

    await restClient.get('/whatever').catch(() => {});

    expect(clearToken).toHaveBeenCalledTimes(1);
    expect(emitSessionExpired).toHaveBeenCalledTimes(1);
  });

  it('ne signale rien sur une autre erreur HTTP', async () => {
    restClient.defaults.adapter = async () => {
      throw Object.assign(new Error('Request failed with status code 500'), {
        isAxiosError: true,
        response: { status: 500, data: {}, statusText: 'Server Error', headers: {}, config: {} },
      });
    };

    await restClient.get('/whatever').catch(() => {});

    expect(clearToken).not.toHaveBeenCalled();
    expect(emitSessionExpired).not.toHaveBeenCalled();
  });
});
