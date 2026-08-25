import { describe, expect, it, vi, beforeEach } from 'vitest';
import { ProviderNetworkError } from '../DataProvider';

vi.mock('../restClient', () => ({
  restClient: { post: vi.fn(), get: vi.fn(), defaults: { baseURL: 'http://x/api' } },
  DEFAULT_BASE_URL: 'http://x/api',
  getApiBaseUrl: () => 'http://x/api',
  initApiBaseUrl: vi.fn(),
  setApiBaseUrl: vi.fn(),
}));

const { restClient } = await import('../restClient');
const { RestProvider } = await import('../RestProvider');

const post = vi.mocked(restClient.post);
const get = vi.mocked(restClient.get);

// Ces tests verrouillent le contrat d'erreur des providers. C'est précisément
// ce contrat qu'un écran avait cessé de respecter : LoginView lisait encore
// `e.response.data.error` (forme axios) alors que le provider normalise en
// Error simple, si bien que *toute* panne s'affichait « Identifiants
// incorrects » — y compris une coupure réseau.

describe('normalisation des erreurs du RestProvider', () => {
  let provider: InstanceType<typeof RestProvider>;
  beforeEach(() => {
    provider = new RestProvider();
    vi.clearAllMocks();
  });

  it('transforme une absence de réponse en ProviderNetworkError', async () => {
    post.mockRejectedValue(Object.assign(new Error('Network Error'), { response: undefined }));
    await expect(provider.login('a', 'b')).rejects.toMatchObject({ isNetworkError: true });
  });

  it('expose le message métier du serveur sur .message', async () => {
    post.mockRejectedValue({ response: { status: 401, data: { error: 'Identifiants invalides' } } });
    await expect(provider.login('a', 'b')).rejects.toMatchObject({
      message: 'Identifiants invalides',
      status: 401,
    });
  });

  it('n\'expose jamais la forme axios `response` aux appelants', async () => {
    post.mockRejectedValue({ response: { status: 500, data: { error: 'boom' } } });
    const err = await provider.login('a', 'b').catch((e) => e);
    // Si `response` réapparaissait, les vues seraient tentées de le lire à
    // nouveau et le couplage à axios reviendrait par la fenêtre.
    expect(err.response).toBeUndefined();
    expect(err.isNetworkError).toBeUndefined();
    expect(err.message).toBe('boom');
  });

  it('rend une erreur exploitable même sans corps de réponse', async () => {
    post.mockRejectedValue({ response: { status: 503, data: null }, message: 'Request failed' });
    const err = await provider.login('a', 'b').catch((e) => e);
    expect(err.message).toBeTruthy();
    expect(err.status).toBe(503);
  });

  it('traite un 404 d\'inventaire comme « aucun inventaire », pas comme une panne', async () => {
    get.mockRejectedValue({ response: { status: 404, data: {} } });
    await expect(provider.fetchInventoryLatest(1)).resolves.toBeNull();
  });
});

describe('ProviderNetworkError', () => {
  it('porte le drapeau que la file hors ligne et les caches inspectent', () => {
    const e = new ProviderNetworkError();
    expect(e.isNetworkError).toBe(true);
    expect(e).toBeInstanceOf(Error);
  });
});
