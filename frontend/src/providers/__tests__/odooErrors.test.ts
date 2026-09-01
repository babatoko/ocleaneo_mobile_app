import { describe, expect, it, vi } from 'vitest';

/**
 * Un signalement réel ("pas de connexion" au login) est resté indiagnosticable
 * deux fois de suite parce que normalizeTransportError() écrasait le détail
 * axios (code + message — DNS, certificat, timeout, connexion refusée...) et
 * ne laissait dans le journal que le message générique de ProviderNetworkError.
 * Ces tests verrouillent que ce détail survit désormais jusqu'au message
 * exposé à l'appelant (et donc jusqu'à services/errorLog.ts, voir
 * LoginView.submit).
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

const { odooClient } = await import('../odooClient');
const { OdooProvider } = await import('../OdooProvider');
const { ProviderNetworkError, ProviderError } = await import('../DataProvider');

const post = vi.mocked(odooClient.post);

describe('OdooProvider — transport sans réponse HTTP', () => {
  it('garde le détail axios (code + message) dans ProviderNetworkError.message', async () => {
    post.mockRejectedValueOnce(
      Object.assign(new Error('Network Error'), { isAxiosError: true, code: 'ERR_NETWORK', response: undefined }),
    );

    const err = await new OdooProvider().login('a', 'b').catch((e) => e);

    expect(err).toBeInstanceOf(ProviderNetworkError);
    expect(err.message).toContain('ERR_NETWORK');
    expect(err.message).toContain('Network Error');
  });

  it('retombe sur le message générique si aucun détail n\'est disponible', async () => {
    post.mockRejectedValueOnce('panne inattendue');

    const err = await new OdooProvider().login('a', 'b').catch((e) => e);

    expect(err).toBeInstanceOf(ProviderNetworkError);
    expect(err.message).toBe('Connexion impossible.');
  });

  it('reste une ProviderError (pas réseau) quand une réponse HTTP existe', async () => {
    post.mockRejectedValueOnce(
      Object.assign(new Error('Request failed with status code 500'), {
        isAxiosError: true,
        response: { status: 500 },
      }),
    );

    const err = await new OdooProvider().login('a', 'b').catch((e) => e);

    expect(err).toBeInstanceOf(ProviderError);
    expect(err.status).toBe(500);
  });
});
