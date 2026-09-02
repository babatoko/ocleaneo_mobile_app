import { createRouter, createWebHistory } from '@ionic/vue-router';
import type { RouteLocationNormalized } from 'vue-router';
import { resolveNavigation } from './guard';
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
  { path: '/aide', name: 'aide', component: () => import('../views/AideView.vue') },
];

const router = createRouter({
  history: createWebHistory(),
  routes,
});

// La politique d'accès vit dans ./guard, hors du câblage du routeur : elle y
// est exerçable par des tests, ce qui n'était pas le cas ici (createRouter et
// createWebHistory exigent un DOM).
router.beforeEach((to: RouteLocationNormalized) => resolveNavigation(to, useAuthStore()));

export default router;
