import { createApp } from 'vue';
import { createPinia } from 'pinia';
import App from './App.vue';
import router from './router';
import { usePointageStore } from './stores/pointage';
import { ensureNotificationChannel } from './services/notifications';
import '@tabler/icons-webfont/dist/tabler-icons.css';
import './style.css';

const app = createApp(App);
const pinia = createPinia();
app.use(pinia);
app.use(router);

// Enregistré avant même le montage : un badge peut relancer l'app depuis
// fermée, la fenêtre pour rater la lecture doit être la plus courte possible.
const pointage = usePointageStore(pinia);
pointage.initGlobalListener(router);
pointage.initOfflineSync();
ensureNotificationChannel();

app.mount('#app');
