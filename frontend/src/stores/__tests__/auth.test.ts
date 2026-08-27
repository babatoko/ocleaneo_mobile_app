import { describe, expect, it, vi, beforeEach } from 'vitest';
import { createPinia, setActivePinia } from 'pinia';

/**
 * Le store d'authentification n'avait aucun test (constat F-03 de l'audit).
 * C'est pourtant lui qui décide si un salarié peut entrer dans l'application,
 * et le seul endroit où le jeton est écrit sur le disque : s'il se désynchronise
 * de localStorage, l'app redémarre dans un état incohérent — un jeton présent
 * au disque mais absent en mémoire, ou l'inverse.
 */

const provider = {
  login: vi.fn(),
  fetchMe: vi.fn(),
};

vi.mock('../../providers', () => ({ provider }));

/** La suite tourne sous Node (aucun jsdom installé, en ajouter un pour ces
 *  tests alourdirait chaque exécution). localStorage est donc simulé — ce qui
 *  a l'avantage de rendre son contenu directement observable. */
let disk: Record<string, string> = {};

const employee = { id: 7, name: 'Awa Diallo' };

beforeEach(async () => {
  disk = {};
  vi.stubGlobal('localStorage', {
    getItem: (k: string) => disk[k] ?? null,
    setItem: (k: string, v: string) => {
      disk[k] = v;
    },
    removeItem: (k: string) => {
      delete disk[k];
    },
  });
  provider.login.mockReset();
  provider.fetchMe.mockReset();
  setActivePinia(createPinia());
});

/** Import différé : l'état initial lit localStorage, il faut donc que le stub
 *  soit posé avant la création du store. */
async function store() {
  const { useAuthStore } = await import('../auth');
  return useAuthStore();
}

describe('store d’authentification', () => {
  it('repart du jeton laissé sur le disque au démarrage', async () => {
    disk['ocleaneo_token'] = 'jeton-de-la-veille';

    const auth = await store();

    expect(auth.token).toBe('jeton-de-la-veille');
    expect(auth.isAuthenticated).toBe(true);
    // L'employé, lui, n'est pas persisté : il est rechargé par fetchMe.
    expect(auth.employee).toBeNull();
  });

  it('démarre déconnecté quand le disque est vide', async () => {
    const auth = await store();

    expect(auth.token).toBeNull();
    expect(auth.isAuthenticated).toBe(false);
  });

  it('écrit le jeton sur le disque à la connexion', async () => {
    provider.login.mockResolvedValue({ token: 'jeton-neuf', employee });
    const auth = await store();

    await auth.login('awa', 'motdepasse');

    expect(provider.login).toHaveBeenCalledWith('awa', 'motdepasse');
    expect(auth.token).toBe('jeton-neuf');
    expect(auth.employee).toEqual(employee);
    // Le point qui compte : mémoire et disque disent la même chose, sinon le
    // prochain démarrage repart d'un état faux.
    expect(disk['ocleaneo_token']).toBe('jeton-neuf');
  });

  it('ne retient rien quand la connexion échoue', async () => {
    provider.login.mockRejectedValue(new Error('Identifiants incorrects'));
    const auth = await store();

    await expect(auth.login('awa', 'faux')).rejects.toThrow();

    expect(auth.token).toBeNull();
    expect(auth.isAuthenticated).toBe(false);
    expect(disk['ocleaneo_token']).toBeUndefined();
  });

  it('efface mémoire ET disque à la déconnexion', async () => {
    disk['ocleaneo_token'] = 'jeton-de-la-veille';
    const auth = await store();
    auth.employee = employee;

    auth.logout();

    expect(auth.token).toBeNull();
    expect(auth.employee).toBeNull();
    expect(auth.isAuthenticated).toBe(false);
    // Sans cette ligne, le jeton révoqué ressusciterait au prochain démarrage.
    expect(disk['ocleaneo_token']).toBeUndefined();
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
    disk['ocleaneo_token'] = 'jeton-valide';
    provider.fetchMe.mockResolvedValue(employee);
    const auth = await store();

    await auth.fetchMe();

    expect(auth.employee).toEqual(employee);
  });

  it('laisse remonter l’échec de fetchMe sans toucher au jeton', async () => {
    // La garde de navigation a besoin de cette erreur pour distinguer une
    // coupure réseau d'un jeton révoqué ; c'est elle qui décide de déconnecter,
    // pas le store.
    disk['ocleaneo_token'] = 'jeton-valide';
    provider.fetchMe.mockRejectedValue(new Error('401'));
    const auth = await store();

    await expect(auth.fetchMe()).rejects.toThrow();

    expect(auth.token).toBe('jeton-valide');
    expect(disk['ocleaneo_token']).toBe('jeton-valide');
  });
});
