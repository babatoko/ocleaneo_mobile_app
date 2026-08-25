import { createRouter, createWebHistory } from '@ionic/vue-router';
import type { RouteLocationNormalized } from 'vue-router';
import { ProviderNetworkError } from '../providers/DataProvider';
import { useAuthStore } from '../stores/auth';

declare module 'vue-router' {
  interface RouteMeta {
    public?: boolean;
  }
}

const routes = [
  { path: '/login', name: 'login', component: () => import('../views/LoginView.vue'), meta: { public: true } },
  // L'ancien écran d'accueil dupliquait la barre de navigation et n'avait plus
  // d'entrée depuis que l'onglet Profil occupe la 5e place : le planning est le
  // véritable point de départ de la journée.
  { path: '/', redirect: '/planning' },

  { path: '/planning', name: 'planning', component: () => import('../views/planning/PlanningView.vue') },
  { path: '/planning/chantier/:id', name: 'planning-chantier', component: () => import('../views/planning/ChantierDetailView.vue'), props: true },
  { path: '/pointage', name: 'pointage', component: () => import('../views/pointage/PointageView.vue') },
  { path: '/pointage/historique', name: 'pointage-historique', component: () => import('../views/pointage/PointageHistoryView.vue') },

  { path: '/commande/catalogue', name: 'commande-catalogue', component: () => import('../views/commande/CatalogueView.vue') },
  { path: '/commande/panier', name: 'commande-panier', component: () => import('../views/commande/PanierView.vue') },
  { path: '/commande/:id/recap', name: 'commande-recap', component: () => import('../views/commande/RecapView.vue'), props: true },

  { path: '/inventaire', name: 'inventaire', component: () => import('../views/inventaire/InventaireView.vue') },
  { path: '/historique', name: 'historique', component: () => import('../views/historique/HistoriqueView.vue') },
  { path: '/profil', name: 'profil', component: () => import('../views/ProfileView.vue') },
];

const router = createRouter({
  history: createWebHistory(),
  routes,
});

/** "/" n'est pas un lien profond à préserver : après connexion, on atterrit
 *  directement sur le planning plutôt que sur l'accueil. */
function toLogin(to: RouteLocationNormalized) {
  return { name: 'login', query: to.path === '/' ? {} : { redirect: to.fullPath } };
}

router.beforeEach(async (to: RouteLocationNormalized) => {
  const auth = useAuthStore();
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
});

export default router;
