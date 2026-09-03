import { describe, expect, it, vi, beforeEach } from 'vitest';
import type { RouteLocationNormalized } from 'vue-router';
import { ProviderNetworkError } from '../../providers/DataProvider';
import { resolveNavigation, sessionExpiredNavigation, type AuthGate } from '../guard';

/**
 * La garde de navigation est l'endroit où le défaut le plus grave de ce projet
 * s'est logé : un jeton expiré rendait l'application entièrement inutilisable,
 * /login compris, et il fallait la réinstaller. Elle n'était couverte par aucun
 * test — elle ne pouvait pas l'être, mêlée au câblage du routeur qui exige un
 * DOM (constat F-03 de l'audit).
 *
 * Les deux cas d'erreur ne se ressemblent pas et c'est tout l'enjeu : une
 * coupure réseau ne doit PAS déconnecter (le salarié perdrait son planning
 * hors ligne), un jeton révoqué DOIT déconnecter (sinon plus rien n'est
 * atteignable).
 */

const route = (path: string, opts: { public?: boolean } = {}): RouteLocationNormalized =>
  ({ path, fullPath: path, meta: { public: opts.public } }) as RouteLocationNormalized;

function gate(over: Partial<AuthGate> = {}): AuthGate {
  return {
    isAuthenticated: false,
    employee: null,
    fetchMe: vi.fn().mockResolvedValue(undefined),
    logout: vi.fn(),
    ...over,
  };
}

let auth: AuthGate;

beforeEach(() => {
  auth = gate();
});

describe('visiteur sans jeton', () => {
  it('est renvoyé vers la connexion, avec la destination en mémoire', async () => {
    expect(await resolveNavigation(route('/pointage'), auth)).toEqual({
      name: 'login',
      query: { redirect: '/pointage' },
    });
  });

  it('n’emporte pas "/" comme destination', async () => {
    // Après connexion on atterrit sur le planning, pas sur une redirection
    // vers la racine qui rebondirait aussitôt.
    expect(await resolveNavigation(route('/'), auth)).toEqual({ name: 'login', query: {} });
  });

  it('atteint quand même l’écran de connexion', async () => {
    expect(await resolveNavigation(route('/login', { public: true }), auth)).toBe(true);
  });
});

describe('salarié connecté', () => {
  it('charge son profil une seule fois', async () => {
    auth = gate({ isAuthenticated: true });

    expect(await resolveNavigation(route('/planning'), auth)).toBe(true);
    expect(auth.fetchMe).toHaveBeenCalledTimes(1);
  });

  it('ne recharge pas son profil déjà en mémoire', async () => {
    // Sinon chaque changement d'onglet déclencherait un appel réseau.
    auth = gate({ isAuthenticated: true, employee: { id: 7 } });

    expect(await resolveNavigation(route('/planning'), auth)).toBe(true);
    expect(auth.fetchMe).not.toHaveBeenCalled();
  });

  it('n’interroge jamais le serveur sur une route publique', async () => {
    // Même avec un jeton invalide en mémoire : /login doit rester atteignable
    // quoi qu'il arrive à cet appel.
    auth = gate({ isAuthenticated: true, fetchMe: vi.fn().mockRejectedValue(new Error('401')) });

    expect(await resolveNavigation(route('/login', { public: true }), auth)).toBe(true);
    expect(auth.fetchMe).not.toHaveBeenCalled();
  });
});

describe('hors ligne', () => {
  it('laisse entrer et ne déconnecte pas', async () => {
    // Le jeton n'est pas invalide pour autant, et les écrans ont leur repli sur
    // le cache local : déconnecter ici priverait le salarié de son planning au
    // moment précis où il en a le plus besoin.
    auth = gate({
      isAuthenticated: true,
      fetchMe: vi.fn().mockRejectedValue(new ProviderNetworkError('réseau indisponible')),
    });

    expect(await resolveNavigation(route('/planning'), auth)).toBe(true);
    expect(auth.logout).not.toHaveBeenCalled();
  });
});

describe('jeton expiré ou révoqué', () => {
  it('déconnecte et renvoie vers la connexion', async () => {
    // LA régression à ne jamais réintroduire. Sans le logout, isAuthenticated
    // reste vrai, la garde rejette en boucle, et plus aucune route — pas même
    // /login — n'est atteignable : écran blanc, onglets inertes, application
    // bonne à réinstaller.
    auth = gate({
      isAuthenticated: true,
      fetchMe: vi.fn().mockRejectedValue(new Error('401 Unauthorized')),
    });

    const result = await resolveNavigation(route('/planning'), auth);

    expect(auth.logout).toHaveBeenCalledTimes(1);
    expect(result).toEqual({ name: 'login', query: { redirect: '/planning' } });
  });

  it('traite une panne serveur comme un refus, pas comme une coupure', async () => {
    // Un 500 n'est pas une ProviderNetworkError : on ne peut pas affirmer que
    // le jeton est bon, et laisser entrer donnerait une app à moitié vivante.
    auth = gate({
      isAuthenticated: true,
      fetchMe: vi.fn().mockRejectedValue(new Error('500 Internal Server Error')),
    });

    expect(await resolveNavigation(route('/planning'), auth)).toEqual({
      name: 'login',
      query: { redirect: '/planning' },
    });
    expect(auth.logout).toHaveBeenCalled();
  });
});

describe('sessionExpiredNavigation — jeton rejeté en cours de session (pas à la navigation)', () => {
  // Même régression que ci-dessus ("jeton expiré ou révoqué"), atteinte par
  // un autre chemin : un appel de données (planning, pointage…) échoue avec
  // un 401 alors que l'employé est déjà chargé en mémoire, donc
  // resolveNavigation ne rappelle jamais fetchMe() (son propre filet ne
  // s'exécute que quand `employee` est vide) et ne peut pas rattraper le cas.

  it('déconnecte et renvoie vers la connexion', () => {
    auth = gate({ isAuthenticated: true, employee: { id: 7 } });

    const result = sessionExpiredNavigation(auth, route('/planning'));

    expect(auth.logout).toHaveBeenCalledTimes(1);
    expect(result).toEqual({ name: 'login', query: { redirect: '/planning' } });
  });

  it('ne fait rien si déjà déconnecté (pas de double logout)', () => {
    auth = gate({ isAuthenticated: false });

    expect(sessionExpiredNavigation(auth, route('/planning'))).toBeNull();
    expect(auth.logout).not.toHaveBeenCalled();
  });

  it('ne redirige pas si déjà sur l’écran de connexion', () => {
    auth = gate({ isAuthenticated: true });

    const result = sessionExpiredNavigation(auth, route('/login', { public: true }));

    expect(auth.logout).toHaveBeenCalledTimes(1);
    expect(result).toBeNull();
  });
});
