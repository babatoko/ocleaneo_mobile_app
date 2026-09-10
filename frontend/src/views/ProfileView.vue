<script setup lang="ts">
import { computed, onMounted, ref } from 'vue';
import { useRouter } from 'vue-router';
import {
  IonButton,
  IonContent,
  IonIcon,
  IonItem,
  IonLabel,
  IonList,
  IonNote,
  IonPage,
  IonToggle,
} from '@ionic/vue';
import {
  logOutOutline,
  notificationsOutline,
  globeOutline,
  moonOutline,
  serverOutline,
  bugOutline,
  documentTextOutline,
  helpCircleOutline,
  chevronForwardOutline,
  businessOutline,
} from 'ionicons/icons';
import { useAuthStore } from '../stores/auth';
import { PROVIDER_KIND_LABELS, useProviderKind } from '../composables/useProviderKind';
import type { ProviderKind } from '../providers';
import { areNotificationsEnabled, setNotificationsEnabled } from '../services/notifications';
import { failedCount, queueLength } from '../services/offlineQueue';
import { errorCount, isTraceModeEnabled, setTraceModeEnabled, shareErrorLog } from '../services/errorLog';
import { getAppVersion } from '../services/appInfo';

const auth = useAuthStore();
const router = useRouter();

const notificationsEnabled = ref(true);
const pendingCount = ref(0);
const failedPointages = ref(0);
const errorsLogged = ref(0);
const traceModeEnabled = ref(false);
const appVersion = ref('');
const loading = ref(true);
const darkMode = ref(false);

const { providerKind } = useProviderKind();

const initials = computed(() => {
  const name = auth.employee?.name || '';
  return name
    .split(' ')
    .filter(Boolean)
    .slice(0, 2)
    .map((w) => w[0].toUpperCase())
    .join('');
});

onMounted(async () => {
  try {
    notificationsEnabled.value = await areNotificationsEnabled();
    pendingCount.value = await queueLength();
    failedPointages.value = await failedCount();
    errorsLogged.value = await errorCount();
    traceModeEnabled.value = await isTraceModeEnabled();
    appVersion.value = await getAppVersion();
    darkMode.value = document.documentElement.getAttribute('data-theme') === 'dark'
      || window.matchMedia('(prefers-color-scheme: dark)').matches;
  } finally {
    loading.value = false;
  }
});

async function toggleNotifications() {
  const next = !notificationsEnabled.value;
  notificationsEnabled.value = next;
  await setNotificationsEnabled(next);
}

async function toggleTraceMode() {
  const next = !traceModeEnabled.value;
  traceModeEnabled.value = next;
  await setTraceModeEnabled(next);
}

function toggleDarkMode() {
  darkMode.value = !darkMode.value;
  document.documentElement.setAttribute('data-theme', darkMode.value ? 'dark' : 'light');
}


function logout() {
  auth.logout();
  router.replace('/login');
}


</script>

<template>
  <ion-page>
    <ion-content>
      <div class="profile-page">
        <!-- Header -->
        <header class="profile-header">
          <h1 class="profile-title">Profil</h1>
          <button class="settings-btn" aria-label="Paramètres">
            <ion-icon :icon="moonOutline" aria-hidden="true"></ion-icon>
          </button>
        </header>

        <!-- Identity card -->
        <section class="identity-card">
          <div class="avatar-wrap">
            <div class="profile-avatar">{{ initials || '?' }}</div>
            <div class="avatar-status" aria-label="Actif">
              <ion-icon :icon="notificationsOutline" aria-hidden="true"></ion-icon>
            </div>
          </div>
          <h2 class="profile-name">{{ auth.employee?.name || 'Salarié' }}</h2>
          <p class="profile-role">Responsable d'exploitation</p>
          <div class="company-pill">
            <ion-icon :icon="businessOutline" aria-hidden="true"></ion-icon>
            Entretien Mâconnais
          </div>
        </section>
        <!-- Agent card hidden until future AI assistant feature (see issue #99) -->

        <!-- Preferences -->
        <template v-if="!loading">
          <p class="section-title">Préférences</p>
          <ion-list class="grouped-list" lines="full">
            <ion-item class="grouped-row">
              <div slot="start" class="row-icon">
                <ion-icon :icon="notificationsOutline" aria-hidden="true"></ion-icon>
              </div>
              <ion-label class="ion-text-wrap">
                <p class="row-label">Notifications</p>
                <p class="row-sub">Chantier en cours, rappels, changements de planning</p>
              </ion-label>
              <ion-toggle
                slot="end"
                class="app-toggle"
                :checked="notificationsEnabled"
                :aria-label="true"
                @ion-change="toggleNotifications"
              ></ion-toggle>
            </ion-item>

            <ion-item class="grouped-row" :button="false" :detail="false" @click="$event.stopPropagation()">
              <div slot="start" class="row-icon">
                <ion-icon :icon="globeOutline" aria-hidden="true"></ion-icon>
              </div>
              <ion-label>
                <p class="row-label">Langue</p>
              </ion-label>
              <ion-note slot="end" class="row-value">Français</ion-note>
              <ion-icon slot="end" :icon="chevronForwardOutline" class="row-chevron" aria-hidden="true"></ion-icon>
            </ion-item>

            <ion-item class="grouped-row">
              <div slot="start" class="row-icon">
                <ion-icon :icon="moonOutline" aria-hidden="true"></ion-icon>
              </div>
              <ion-label class="ion-text-wrap">
                <p class="row-label">Thème sombre</p>
              </ion-label>
              <ion-toggle
                slot="end"
                class="app-toggle"
                :checked="darkMode"
                :aria-label="true"
                @ion-change="toggleDarkMode"
              ></ion-toggle>
            </ion-item>
          </ion-list>

          <!-- Account -->
          <p class="section-title">Compte</p>
          <ion-list class="grouped-list" lines="full">
            <ion-item class="grouped-row" :button="false" :detail="false" router-link="/securite">
              <div slot="start" class="row-icon">
                <ion-icon :icon="documentTextOutline" aria-hidden="true"></ion-icon>
              </div>
              <ion-label>
                <p class="row-label">Documents personnels</p>
              </ion-label>
              <ion-icon slot="end" :icon="chevronForwardOutline" class="row-chevron" aria-hidden="true"></ion-icon>
            </ion-item>

            <ion-item class="grouped-row" :button="false" :detail="false" router-link="/aide">
              <div slot="start" class="row-icon">
                <ion-icon :icon="helpCircleOutline" aria-hidden="true"></ion-icon>
              </div>
              <ion-label>
                <p class="row-label">Aide &amp; support</p>
              </ion-label>
              <ion-icon slot="end" :icon="chevronForwardOutline" class="row-chevron" aria-hidden="true"></ion-icon>
            </ion-item>
          </ion-list>

          <!-- Server / diagnostic (advanced) -->
          <p class="section-title">Avancé</p>
          <ion-list class="grouped-list" lines="full">
            <ion-item class="grouped-row">
              <div slot="start" class="row-icon">
                <ion-icon :icon="serverOutline" aria-hidden="true"></ion-icon>
              </div>
              <ion-label class="ion-text-wrap">
                <p class="row-label">Backend</p>
                <p class="row-sub">{{ PROVIDER_KIND_LABELS[providerKind as ProviderKind] }}</p>
              </ion-label>
              <ion-note slot="end" class="row-value">{{ providerKind }}</ion-note>
            </ion-item>

            <ion-item class="grouped-row">
              <div slot="start" class="row-icon">
                <ion-icon :icon="bugOutline" aria-hidden="true"></ion-icon>
              </div>
              <ion-label class="ion-text-wrap">
                <p class="row-label">Mode traçage</p>
                <p class="row-sub">Journalise les appels serveur (jamais les identifiants)</p>
              </ion-label>
              <ion-toggle
                slot="end"
                class="app-toggle"
                :checked="traceModeEnabled"
                :aria-label="true"
                @ion-change="toggleTraceMode"
              ></ion-toggle>
            </ion-item>

            <ion-item v-if="errorsLogged" class="grouped-row" :button="false" :detail="false" @click="shareErrorLog">
              <div slot="start" class="row-icon">
                <ion-icon :icon="bugOutline" aria-hidden="true"></ion-icon>
              </div>
              <ion-label class="ion-text-wrap">
                <p class="row-label">Incidents enregistrés</p>
                <p class="row-sub">Transmettre le diagnostic à votre responsable</p>
              </ion-label>
              <ion-note slot="end" class="row-value srow-alert">{{ errorsLogged }}</ion-note>
              <ion-icon slot="end" :icon="chevronForwardOutline" class="row-chevron" aria-hidden="true"></ion-icon>
            </ion-item>
          </ion-list>

          <!-- Offline queue -->
          <p v-if="pendingCount || failedPointages" class="section-title">Hors ligne</p>
          <ion-list v-if="pendingCount || failedPointages" class="grouped-list" lines="full">
            <ion-item v-if="pendingCount" class="grouped-row">
              <ion-label class="ion-text-wrap">
                <p class="row-label">File d'attente pointage</p>
                <p class="row-sub">Pointages en attente d'envoi</p>
              </ion-label>
              <ion-note slot="end" class="row-value">{{ pendingCount }}</ion-note>
            </ion-item>
            <ion-item v-if="failedPointages" class="grouped-row">
              <ion-label class="ion-text-wrap">
                <p class="row-label">Pointages refusés</p>
                <p class="row-sub">Non enregistrés par le serveur</p>
              </ion-label>
              <ion-note slot="end" class="row-value srow-alert">{{ failedPointages }}</ion-note>
            </ion-item>
          </ion-list>

          <!-- Logout -->
          <div class="logout-wrap">
            <ion-button class="logout-btn" expand="block" fill="clear" color="danger" @click="logout">
              <ion-icon slot="start" :icon="logOutOutline"></ion-icon>
              Se déconnecter
            </ion-button>
          </div>

          <p v-if="appVersion" class="app-version">Ocleaneo Mobile · v{{ appVersion }}</p>
        </template>
      </div>
    </ion-content>
  </ion-page>
</template>

<style scoped>
.profile-page {
  padding: 0 16px calc(24px + env(safe-area-inset-bottom));
}

.profile-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: calc(8px + env(safe-area-inset-top)) 0 10px;
}

.profile-title {
  font-size: 28px;
  font-weight: 700;
  margin: 0;
  letter-spacing: -0.3px;
}

.settings-btn {
  width: 40px;
  height: 40px;
  border-radius: 50%;
  border: none;
  background: var(--surface-1);
  color: var(--text-primary);
  display: grid;
  place-items: center;
}

.settings-btn ion-icon {
  font-size: 22px;
}

.identity-card {
  background: var(--surface-2);
  border-radius: 24px;
  padding: 24px 20px;
  margin-bottom: 16px;
  box-shadow: 0 1px 2px rgba(0, 0, 0, 0.04), 0 1px 3px rgba(0, 0, 0, 0.08);
  text-align: center;
}

.avatar-wrap {
  position: relative;
  width: 110px;
  height: 110px;
  margin: 0 auto 14px;
}

.profile-avatar {
  width: 110px;
  height: 110px;
  border-radius: 50%;
  background: var(--accent-bg);
  color: var(--accent-text);
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 36px;
  font-weight: 600;
  border: 4px solid var(--surface-2);
  box-shadow: 0 2px 6px rgba(0, 0, 0, 0.06), 0 4px 12px rgba(0, 0, 0, 0.04);
}

.avatar-status {
  position: absolute;
  bottom: 6px;
  right: 6px;
  width: 28px;
  height: 28px;
  border-radius: 50%;
  background: var(--accent);
  color: var(--on-accent);
  border: 3px solid var(--surface-2);
  display: grid;
  place-items: center;
}

.avatar-status ion-icon {
  font-size: 14px;
}

.profile-name {
  font-size: 22px;
  font-weight: 700;
  margin: 0 0 4px;
}

.profile-role {
  margin: 0 0 16px;
  color: var(--text-secondary);
  font-size: 15px;
}

.company-pill {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  background: var(--accent-bg);
  color: var(--accent-text);
  padding: 6px 12px;
  border-radius: 20px;
  font-size: 13px;
  font-weight: 600;
}

.company-pill ion-icon {
  font-size: 14px;
}



.section-title {
  font-size: 13px;
  font-weight: 600;
  text-transform: uppercase;
  letter-spacing: 0.4px;
  color: var(--text-secondary);
  margin: 24px 0 8px 6px;
  padding: 0;
}

.grouped-list {
  --ion-item-background: var(--surface-2);
  background: var(--surface-2);
  border-radius: 14px;
  overflow: hidden;
  box-shadow: 0 1px 2px rgba(0, 0, 0, 0.04), 0 1px 3px rgba(0, 0, 0, 0.08);
  margin-bottom: 12px;
}

.grouped-row {
  --background: transparent;
  --border-color: var(--border);
  --padding-start: 14px;
  --inner-padding-end: 14px;
  --min-height: 52px;
}

.row-icon {
  width: 30px;
  height: 30px;
  border-radius: 8px;
  display: grid;
  place-items: center;
  background: var(--surface-1);
  color: var(--accent);
  margin-right: 12px;
  flex-shrink: 0;
}

.row-icon ion-icon {
  font-size: 18px;
}

.row-label {
  font-size: 16px;
  font-weight: 500;
  margin: 0;
  color: var(--text-primary);
}

.row-sub {
  font-size: 12px;
  color: var(--text-secondary);
  margin: 2px 0 0;
}

.row-value {
  font-size: 15px;
  color: var(--text-secondary);
  margin-right: 4px;
}

.row-chevron {
  font-size: 18px;
  color: var(--text-secondary);
  flex-shrink: 0;
}

.srow-alert {
  color: var(--danger);
  font-weight: 600;
}

.app-toggle {
  --track-background: var(--border-strong);
  --track-background-checked: var(--accent);
  --handle-background: var(--surface-2);
  --handle-background-checked: var(--surface-2);
  flex-shrink: 0;
}

.logout-wrap {
  margin-top: 16px;
  background: var(--surface-2);
  border-radius: 14px;
  overflow: hidden;
  box-shadow: 0 1px 2px rgba(0, 0, 0, 0.04), 0 1px 3px rgba(0, 0, 0, 0.08);
}

.logout-btn {
  --color: var(--danger);
  font-weight: 600;
  font-size: 15px;
  text-transform: none;
  margin: 0;
  min-height: 52px;
}

.app-version {
  text-align: center;
  color: var(--text-secondary);
  font-size: 12px;
  margin: 20px 0 0;
}
</style>
