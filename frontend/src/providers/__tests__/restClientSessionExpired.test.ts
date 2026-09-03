import { describe, expect, it, vi, beforeEach } from 'vitest';

/**
 * Même défaut que pour OdooProvider (voir odooSessionExpired.test.ts), côté
 * RestProvider : l'intercepteur de réponse de restClient.ts vidait le dépôt
 * de jeton sur un 401 HTTP sans jamais le signaler au reste de l'app — le
 * store d'authentification restait persuadé d'être connecté.
 *
 * Second défaut, plus subtil, corrigé dans le même mouvement : LoginView
 * relance une connexion biométrique dès que le store passe déconnecté
 * (onMounted). Cette reconnexion peut réussir — reposant un jeton valide —
 * AVANT qu'une seconde requête, partie plus tôt avec l'ancien jeton, ne
 * reçoive sa propre réponse 401 tardive. Sans comparer le jeton de la
 * requête en échec au jeton courant au moment de réagir, ce 401 périmé
 * effacerait la session neuve tout juste rétablie.
 */

vi.mock('@capacitor/preferences', () => ({
  Preferences: { get: async () => ({ value: null }), set: async () => {}, remove: async () => {} },
}));

const clearToken = vi.fn(async () => {});
const currentToken = vi.fn((): string | null => null);
vi.mock('../../services/tokenStore', () => ({
  clearToken: () => clearToken(),
  currentToken: () => currentToken(),
}));

const emitSessionExpired = vi.fn();
vi.mock('../../services/sessionEvents', () => ({
  emitSessionExpired: () => emitSessionExpired(),
}));

const { restClient } = await import('../restClient');

// `config` vient de l'appel réel (donc porte l'en-tête Authorization posé
// par l'intercepteur de requête ci-dessus, avec son .get() fonctionnel) —
// contrairement à un objet `{}` reconstruit à la main, qui ne permettrait
// pas à tokenFromFailedRequest() de relire quoi que ce soit.
function respondWith401(): void {
  restClient.defaults.adapter = async (config) => {
    throw Object.assign(new Error('Request failed with status code 401'), {
      isAxiosError: true,
      config,
      response: { status: 401, data: {}, statusText: 'Unauthorized', headers: {}, config },
    });
  };
}

describe('restClient — jeton rejeté en cours de session', () => {
  beforeEach(() => {
    clearToken.mockClear();
    emitSessionExpired.mockClear();
    currentToken.mockReset().mockReturnValue(null);
  });

  it("vide le dépôt de jeton ET signale l'expiration sur un 401 HTTP encore courant", async () => {
    // Même jeton pour la requête (posé par l'intercepteur de requête) et pour
    // la vérification de fraîcheur (intercepteur de réponse) : rien ne s'est
    // reconnecté entre-temps, le 401 est bien à prendre en compte.
    currentToken.mockReturnValue('jeton-actuel');
    respondWith401();

    await restClient.get('/whatever').catch(() => {});

    expect(clearToken).toHaveBeenCalledTimes(1);
    expect(emitSessionExpired).toHaveBeenCalledTimes(1);
  });

  it('ne signale rien sur une autre erreur HTTP', async () => {
    currentToken.mockReturnValue('jeton-actuel');
    restClient.defaults.adapter = async (config) => {
      throw Object.assign(new Error('Request failed with status code 500'), {
        isAxiosError: true,
        config,
        response: { status: 500, data: {}, statusText: 'Server Error', headers: {}, config },
      });
    };

    await restClient.get('/whatever').catch(() => {});

    expect(clearToken).not.toHaveBeenCalled();
    expect(emitSessionExpired).not.toHaveBeenCalled();
  });

  it('ignore un 401 tardif si le jeton a déjà été renouvelé entre-temps (reconnexion biométrique concurrente)', async () => {
    // Premier appel (intercepteur de requête, pose l'en-tête) : ancien jeton.
    // Deuxième appel (intercepteur de réponse, vérifie la fraîcheur) : un
    // nouveau jeton est déjà en place — une reconnexion a eu lieu entre les
    // deux, ce 401 ne décrit plus l'état courant.
    let calls = 0;
    currentToken.mockImplementation(() => (calls++ === 0 ? 'ancien-jeton' : 'nouveau-jeton'));
    respondWith401();

    await restClient.get('/whatever').catch(() => {});

    expect(clearToken).not.toHaveBeenCalled();
    expect(emitSessionExpired).not.toHaveBeenCalled();
  });

  it("ne signale rien pour une requête partie sans jeton (ex. login())", async () => {
    currentToken.mockReturnValue(null);
    respondWith401();

    await restClient.get('/whatever').catch(() => {});

    expect(clearToken).not.toHaveBeenCalled();
    expect(emitSessionExpired).not.toHaveBeenCalled();
  });
});
