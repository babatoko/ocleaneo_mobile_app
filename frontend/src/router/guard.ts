import type { RouteLocationNormalized } from 'vue-router';
import { ProviderNetworkError } from '../providers/DataProvider';

/**
 * Politique d'accès aux routes, séparée du câblage du routeur.
 *
 * Elle vivait dans router/index.ts, mêlée à createRouter/createWebHistory qui
 * exigent un DOM : impossible à exercer dans une suite qui tourne sous Node.
 * C'est précisément ce qui a laissé passer le défaut le plus grave rencontré
 * sur ce projet — un jeton expiré rendait l'application inutilisable, /login
 * compris, et seule une réinstallation permettait de repartir.
 *
 * Isolée ici, la politique se teste sans navigateur.
 */

/** Le strict nécessaire, côté store, pour décider. Volontairement plus étroit
 *  que le store lui-même : la politique n'a pas à connaître le reste. */
export interface AuthGate {
  isAuthenticated: boolean;
  employee: unknown;
  fetchMe(): Promise<void>;
  logout(): void;
}

export type Navigation = true | { name: 'login'; query: Record<string, string> };

/** "/" n'est pas un lien profond à préserver : après connexion, on atterrit
 *  directement sur le planning plutôt que sur l'accueil. */
export function toLogin(to: RouteLocationNormalized): Navigation {
  return { name: 'login', query: to.path === '/' ? {} : { redirect: to.fullPath } };
}

export async function resolveNavigation(
  to: RouteLocationNormalized,
  auth: AuthGate,
): Promise<Navigation> {
  if (!to.meta.public && !auth.isAuthenticated) {
    return toLogin(to);
  }
  // Jamais sur une route publique : l'écran de connexion doit rester
  // atteignable quoi qu'il arrive à cet appel, y compris avec un jeton
  // invalide encore en mémoire.
  if (!to.meta.public && auth.isAuthenticated && !auth.employee) {
    try {
      await auth.fetchMe();
    } catch (e) {
      // Hors ligne : on laisse entrer. Le jeton n'est pas invalide pour
      // autant, et les écrans ont leur propre repli sur le cache local —
      // déconnecter ici priverait le salarié de son planning hors réseau.
      if (e instanceof ProviderNetworkError) return true;
      // Jeton expiré ou révoqué. Sans ce rattrapage, la garde rejetait : la
      // navigation était annulée sur un écran vide, et comme le jeton restait
      // en mémoire (`isAuthenticated` toujours vrai) plus aucune route, pas
      // même /login, n'était atteignable — l'app était bonne à réinstaller.
      auth.logout();
      return toLogin(to);
    }
  }
  return true;
}

/**
 * Réaction à un jeton rejeté (401) en cours de session — cas distinct de
 * `resolveNavigation` ci-dessus, qui ne s'exécute qu'à la navigation. Un
 * appel de données (planning, pointage…) peut échouer avec un jeton
 * expiré/révoqué sans qu'aucune navigation n'ait lieu : l'employé restait
 * alors chargé en mémoire (`auth.employee` déjà rempli), `isAuthenticated`
 * restait vrai, et rien ne redéclenchait jamais le rattrapage ci-dessus —
 * exactement la même régression que "jeton expiré ou révoqué" plus haut,
 * atteinte par un autre chemin. Voir services/sessionEvents.ts (détection,
 * côté providers) et main.ts (câblage).
 *
 * Renvoie la navigation à effectuer, ou `null` si rien à faire (déjà
 * déconnecté, ou déjà sur /login) — le côté effectif (`router.push`) reste
 * dans main.ts, hors de portée des tests unitaires au même titre que
 * `router/index.ts` pour `resolveNavigation`.
 */
export function sessionExpiredNavigation(
  auth: Pick<AuthGate, 'isAuthenticated' | 'logout'>,
  current: RouteLocationNormalized,
): Navigation | null {
  if (!auth.isAuthenticated) return null;
  auth.logout();
  // Même critère que resolveNavigation ci-dessus (meta.public, pas le nom de
  // la route) : l'écran de connexion est déjà atteignable, y compris avec un
  // jeton invalide en mémoire — inutile de le rediriger vers lui-même.
  if (current.meta.public) return null;
  return toLogin(current);
}
