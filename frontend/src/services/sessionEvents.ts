/**
 * Signal qu'un jeton d'authentification vient d'être rejeté par le serveur
 * (401) en cours de session — pas au démarrage, où router/guard.ts s'en
 * charge déjà via son propre fetchMe().
 *
 * Sans ça, un jeton expiré ou révoqué pendant que l'app tourne (l'employé
 * était déjà connecté, son profil déjà chargé) ne mettait à jour que le
 * dépôt de jeton (services/tokenStore.ts) : le store d'authentification
 * (isAuthenticated, employee) restait figé sur son dernier état valide, la
 * garde de navigation ne se redéclenche que sur un changement de route, et
 * l'agent restait bloqué sur son écran avec des appels qui échouaient en
 * boucle — un message technique ("unauthorized") sans jamais revenir à
 * l'écran de connexion. Ce module découple la détection (providers/*) de la
 * réaction (store + routeur, câblés dans main.ts) sans faire dépendre les
 * providers de Pinia ou du routeur.
 */

type Listener = () => void;

const listeners = new Set<Listener>();

export function onSessionExpired(listener: Listener): void {
  listeners.add(listener);
}

export function emitSessionExpired(): void {
  listeners.forEach((listener) => listener());
}
