import { describe, expect, it, vi, beforeEach } from 'vitest';
import { createPinia, setActivePinia } from 'pinia';

/**
 * Le store d'authentification n'avait aucun test (constat F-03 de l'audit).
 * C'est pourtant lui qui décide si un salarié peut entrer dans l'application.
 *
 * Depuis F-07, il n'écrit plus lui-même sur le disque : le jeton appartient à
 * services/tokenStore.ts, qui le confie au Trousseau/Keystore sur natif. Le
 * contrat vérifié ici est donc « le store délègue au dépôt », et le stockage
 * lui-même est couvert par tokenStore.test.ts. La frontière est la même que
 * pour la garde de navigation : chaque test vise une seule responsabilité.
 */

const provider = {
  login: vi.fn(),
  fetchMe: vi.fn(),
};

vi.mock('../../providers', () => ({ provider }));

/** Dépôt de jetons simulé : ce qu'il contient est directement observable, et
 *  aucun test du store ne dépend de la plateforme de stockage réelle. */
let stored: string | null = null;

vi.mock('../../services/tokenStore', () => ({
  currentToken: () => stored,
  saveToken: vi.fn(async (t: string) => {
    stored = t;
  }),
  clearToken: vi.fn(async () => {
    stored = null;
  }),
}));

const { saveToken, clearToken } = await import('../../services/tokenStore');

const employee = { id: 7, name: 'Awa Diallo' };

beforeEach(() => {
  stored = null;
  provider.login.mockReset();
  provider.fetchMe.mockReset();
  vi.mocked(saveToken).mockClear();
  vi.mocked(clearToken).mockClear();
  setActivePinia(createPinia());
});

/** Import différé : l'état initial lit le dépôt, il doit donc être garni
 *  avant la création du store — exactement comme main.ts appelle loadToken()
 *  avant de monter l'application. */
async function store() {
  const { useAuthStore } = await import('../auth');
  return useAuthStore();
}

describe('store d’authentification', () => {
  it('repart du jeton déjà chargé au démarrage', async () => {
    stored = 'jeton-de-la-veille';

    const auth = await store();

    expect(auth.token).toBe('jeton-de-la-veille');
    expect(auth.isAuthenticated).toBe(true);
    // L'employé, lui, n'est pas persisté : il est rechargé par fetchMe.
    expect(auth.employee).toBeNull();
  });

  it('démarre déconnecté quand le dépôt est vide', async () => {
    const auth = await store();

    expect(auth.token).toBeNull();
    expect(auth.isAuthenticated).toBe(false);
  });

  it('confie le jeton au dépôt à la connexion', async () => {
    provider.login.mockResolvedValue({ token: 'jeton-neuf', employee });
    const auth = await store();

    await auth.login('awa', 'motdepasse');

    expect(provider.login).toHaveBeenCalledWith('awa', 'motdepasse');
    expect(auth.token).toBe('jeton-neuf');
    expect(auth.employee).toEqual(employee);
    // Le point qui compte : mémoire et dépôt disent la même chose, sinon le
    // prochain démarrage repart d'un état faux.
    expect(saveToken).toHaveBeenCalledWith('jeton-neuf');
    expect(stored).toBe('jeton-neuf');
  });

  it('ne retient rien quand la connexion échoue', async () => {
    provider.login.mockRejectedValue(new Error('Identifiants incorrects'));
    const auth = await store();

    await expect(auth.login('awa', 'faux')).rejects.toThrow();

    expect(auth.token).toBeNull();
    expect(auth.isAuthenticated).toBe(false);
    expect(saveToken).not.toHaveBeenCalled();
  });

  it('efface mémoire ET dépôt à la déconnexion', async () => {
    stored = 'jeton-de-la-veille';
    const auth = await store();
    auth.employee = employee;

    auth.logout();

    expect(auth.token).toBeNull();
    expect(auth.employee).toBeNull();
    expect(auth.isAuthenticated).toBe(false);
    // Sans cet appel, le jeton révoqué ressusciterait au prochain démarrage.
    expect(clearToken).toHaveBeenCalled();
  });

  it('n’interroge pas le serveur sans jeton', async () => {
    const auth = await store();

    await auth.fetchMe();

    // Un appel ici partirait sans en-tête d'authentification pour repartir
    // avec un 401 : du bruit réseau garanti, sur des téléphones en 3G.
    expect(provider.fetchMe).not.toHaveBeenCalled();
    expect(auth.employee).toBeNull();
  });

  it('charge l’employé quand un jeton est présent', async () => {
    stored = 'jeton-valide';
    provider.fetchMe.mockResolvedValue(employee);
    const auth = await store();

    await auth.fetchMe();

    expect(auth.employee).toEqual(employee);
  });

  it('laisse remonter l’échec de fetchMe sans toucher au jeton', async () => {
    // La garde de navigation a besoin de cette erreur pour distinguer une
    // coupure réseau d'un jeton révoqué ; c'est elle qui décide de déconnecter,
    // pas le store.
    stored = 'jeton-valide';
    provider.fetchMe.mockRejectedValue(new Error('401'));
    const auth = await store();

    await expect(auth.fetchMe()).rejects.toThrow();

    expect(auth.token).toBe('jeton-valide');
    expect(clearToken).not.toHaveBeenCalled();
  });
});
