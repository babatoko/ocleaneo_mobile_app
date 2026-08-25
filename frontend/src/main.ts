import { createApp } from 'vue';
import { createPinia } from 'pinia';
import { IonicVue } from '@ionic/vue';
import App from './App.vue';
import router from './router';
import { usePointageStore } from './stores/pointage';
import { ensureNotificationChannel } from './services/notifications';
import { initProvider } from './providers';

// Ionic apporte les mécanismes (transitions de page, geste de retour iOS,
// clavier/scroll adaptatifs, safe-area) — le style visuel Ocleaneo reste
// celui de style.css, chargé après pour garder la main sur les couleurs.
import '@ionic/vue/css/core.css';
import '@ionic/vue/css/normalize.css';
import '@ionic/vue/css/structure.css';
import '@ionic/vue/css/typography.css';
import './style.css';

const app = createApp(App);
app.use(IonicVue, { mode: 'ios' }); // un seul look, cohérent sur les deux plateformes — pas de rendu Material/Cupertino qui diverge de l'identité Ocleaneo
const pinia = createPinia();
app.use(pinia);

// L'URL de serveur (personnalisable depuis le profil) doit être appliquée
// avant le premier appel réseau. `app.use(router)` déclenche déjà, en
// interne, la navigation initiale (donc la garde d'authentification et son
// fetchMe()) de façon asynchrone — il faut donc terminer ceci avant, pas
// seulement avant app.mount().
await initProvider();
app.use(router);

// Enregistré avant même le montage : un badge peut relancer l'app depuis
// fermée, la fenêtre pour rater la lecture doit être la plus courte possible.
const pointage = usePointageStore(pinia);
pointage.initGlobalListener(router);
pointage.initOfflineSync();
ensureNotificationChannel();

app.mount('#app');
