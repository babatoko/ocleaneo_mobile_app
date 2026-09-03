import { createApp } from 'vue';
import { createPinia } from 'pinia';
import { IonicVue } from '@ionic/vue';
import App from './App.vue';
import router from './router';
import { sessionExpiredNavigation } from './router/guard';
import { usePointageStore } from './stores/pointage';
import { useAuthStore } from './stores/auth';
import { ensureNotificationChannel } from './services/notifications';
import { initProvider } from './providers';
import { installErrorHandlers } from './services/errorLog';
import { loadToken } from './services/tokenStore';
import { onSessionExpired } from './services/sessionEvents';
import { setupServiceWorker } from './services/pwaUpdate';

// Ionic apporte les mécanismes (transitions de page, geste de retour iOS,
// clavier/scroll adaptatifs, safe-area) — le style visuel Ocleaneo reste
// celui de style.css, chargé après pour garder la main sur les couleurs.
import '@ionic/vue/css/core.css';
import '@ionic/vue/css/normalize.css';
import '@ionic/vue/css/structure.css';
import '@ionic/vue/css/typography.css';
import './style.css';

const app = createApp(App);
// Posé avant tout le reste : une erreur pendant l'initialisation est
// exactement celle qu'on ne veut pas perdre, et c'est la plus probable.
installErrorHandlers(app);
// Non attendu : purge un service worker/cache d'une version précédente en
// tâche de fond (natif) ou enregistre celui de la PWA (web) — rien d'autre
// n'a besoin d'attendre ça pour démarrer.
void setupServiceWorker();
app.use(IonicVue, { mode: 'ios' }); // un seul look, cohérent sur les deux plateformes — pas de rendu Material/Cupertino qui diverge de l'identité Ocleaneo
const pinia = createPinia();
app.use(pinia);

// Le jeton vit dans le Trousseau/Keystore sur natif, dont la lecture est
// asynchrone, alors que les intercepteurs axios posent l'en-tête
// Authorization de façon synchrone. On hydrate donc le cache ici, avant le
// premier appel réseau ET avant la création du store d'authentification, qui
// lit ce cache pour son état initial. Voir services/tokenStore.ts.
await loadToken();

// L'URL de serveur (personnalisable depuis le profil) doit être appliquée
// avant le premier appel réseau. `app.use(router)` déclenche déjà, en
// interne, la navigation initiale (donc la garde d'authentification et son
// fetchMe()) de façon asynchrone — il faut donc terminer ceci avant, pas
// seulement avant app.mount().
await initProvider();
app.use(router);

// Un jeton rejeté (401) en cours de session — pas au démarrage, où
// router/guard.ts s'en charge déjà — ne met sinon à jour que le dépôt de
// jeton : le store d'authentification restait persuadé d'être connecté et
// l'agent bloquait sur son écran avec des appels en échec. Voir
// services/sessionEvents.ts.
onSessionExpired(() => {
  const nav = sessionExpiredNavigation(useAuthStore(pinia), router.currentRoute.value);
  if (nav && nav !== true) void router.push(nav);
});

// Enregistré avant même le montage : un badge peut relancer l'app depuis
// fermée, la fenêtre pour rater la lecture doit être la plus courte possible.
const pointage = usePointageStore(pinia);
pointage.initGlobalListener(router);
pointage.initOfflineSync();
ensureNotificationChannel();

app.mount('#app');
