import { createRouter, createWebHistory } from 'vue-router';
import { useAuthStore } from '../stores/auth';

const routes = [
  { path: '/login', name: 'login', component: () => import('../views/LoginView.vue'), meta: { public: true } },
  { path: '/', name: 'home', component: () => import('../views/HomeView.vue') },

  { path: '/planning', name: 'planning', component: () => import('../views/planning/PlanningView.vue') },
  { path: '/pointage', name: 'pointage', component: () => import('../views/pointage/PointageView.vue') },

  { path: '/commande/catalogue', name: 'commande-catalogue', component: () => import('../views/commande/CatalogueView.vue') },
  { path: '/commande/panier', name: 'commande-panier', component: () => import('../views/commande/PanierView.vue') },
  { path: '/commande/:id/recap', name: 'commande-recap', component: () => import('../views/commande/RecapView.vue'), props: true },

  { path: '/inventaire', name: 'inventaire', component: () => import('../views/inventaire/InventaireView.vue') },
  { path: '/historique', name: 'historique', component: () => import('../views/historique/HistoriqueView.vue') },
];

const router = createRouter({
  history: createWebHistory(),
  routes,
});

router.beforeEach(async (to) => {
  const auth = useAuthStore();
  if (!to.meta.public && !auth.isAuthenticated) {
    return { name: 'login', query: { redirect: to.fullPath } };
  }
  if (auth.isAuthenticated && !auth.employee) {
    await auth.fetchMe();
  }
  return true;
});

export default router;
