<script setup lang="ts">
import { computed, onMounted, ref } from 'vue';
import { useRouter } from 'vue-router';
import { IonButton, IonContent, IonIcon, IonInput, IonItem, IonLabel, IonList, IonNote, IonPage, IonToggle } from '@ionic/vue';
import { logOutOutline } from 'ionicons/icons';
import { provider } from '../providers';
import { useAuthStore } from '../stores/auth';
import {
  clearSavedCredentials,
  hasSavedCredentials,
  isBiometricAvailable,
} from '../services/biometric';
import { areNotificationsEnabled, setNotificationsEnabled } from '../services/notifications';
import { failedCount, queueLength } from '../services/offlineQueue';
import { clearErrorLog, errorCount, formatErrorLog } from '../services/errorLog';
import { Share } from '@capacitor/share';

const auth = useAuthStore();
const router = useRouter();

const biometricAvailable = ref(false);
const biometricSaved = ref(false);
const notificationsEnabled = ref(true);
const pendingCount = ref(0);
const failedPointages = ref(0);
const errorsLogged = ref(0);
const loading = ref(true);

const defaultServerUrl = provider.getDefaultServerUrl();
const currentServerUrl = ref(provider.getServerUrl());
const serverUrlInput = ref(currentServerUrl.value || '');
const serverUrlError = ref('');
const savingServerUrl = ref(false);

const showServerSetting = currentServerUrl.value !== null;
const serverUrlOverridden = computed(() => currentServerUrl.value !== defaultServerUrl);
const serverUrlChanged = computed(() => serverUrlInput.value.trim().replace(/\/+$/, '') !== currentServerUrl.value);

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
    biometricAvailable.value = await isBiometricAvailable();
    if (biometricAvailable.value) biometricSaved.value = await hasSavedCredentials();
    notificationsEnabled.value = await areNotificationsEnabled();
    pendingCount.value = await queueLength();
    failedPointages.value = await failedCount();
    errorsLogged.value = await errorCount();
  } finally {
    loading.value = false;
  }
});

/** Transmettre le journal est le seul moyen, aujourd'hui, de faire remonter
 *  un plantage : rien n'est envoyé automatiquement (voir services/errorLog.ts). */
async function shareErrorLog() {
  const text = await formatErrorLog();
  try {
    await Share.share({ title: 'Journal d\'erreurs Ocleaneo', text });
  } catch {
    // Partage annulé, ou indisponible en navigateur : sans conséquence, le
    // journal reste sur l'appareil.
  }
}

async function forgetErrorLog() {
  await clearErrorLog();
  errorsLogged.value = 0;
}

async function toggleNotifications() {
  const next = !notificationsEnabled.value;
  notificationsEnabled.value = next;
  await setNotificationsEnabled(next);
}

async function disableBiometric() {
  if (!biometricSaved.value) return; // pas de mot de passe en mémoire pour l'activer depuis cet écran
  await clearSavedCredentials();
  biometricSaved.value = false;
}

function isValidUrl(value: string) {
  try {
    const u = new URL(value);
    return u.protocol === 'http:' || u.protocol === 'https:';
  } catch {
    return false;
  }
}

function logout() {
  auth.logout();
  router.replace('/login');
}

async function saveServerUrl() {
  const next = serverUrlInput.value.trim();
  serverUrlError.value = '';
  if (!isValidUrl(next)) {
    serverUrlError.value = 'URL invalide (doit commencer par http:// ou https://).';
    return;
  }
  savingServerUrl.value = true;
  try {
    await provider.setServerUrl(next);
  } finally {
    savingServerUrl.value = false;
  }
  // Le jeton de session n'a aucune raison d'être valide sur un autre serveur.
  logout();
}

async function resetServerUrl() {
  savingServerUrl.value = true;
  try {
    await provider.setServerUrl('');
  } finally {
    savingServerUrl.value = false;
  }
  logout();
}
</script>

<template>
  <ion-page>
    <ion-content>
      <div class="profile-header">
        <div class="profile-avatar">{{ initials || '?' }}</div>
        <p class="profile-name">{{ auth.employee?.name || 'Salarié' }}</p>
      </div>

      <template v-if="!loading">
        <p class="section-title">Paramètres</p>
        <ion-list class="detail-block settings-list" lines="full">
          <ion-item class="settings-row">
            <ion-label class="ion-text-wrap">
              <p class="srow-label">Notifications</p>
              <p class="srow-sub">Chantier en cours, rappels de vacation, changements de planning</p>
            </ion-label>
            <ion-toggle
              slot="end"
              class="app-toggle"
              :checked="notificationsEnabled"
              aria-label="Notifications"
              @ion-change="toggleNotifications"
            ></ion-toggle>
          </ion-item>

          <ion-item v-if="biometricAvailable" class="settings-row">
            <ion-label class="ion-text-wrap">
              <p class="srow-label">Connexion biométrique</p>
              <p class="srow-sub">
                {{ biometricSaved ? 'Activée à la dernière connexion' : 'Reconnectez-vous avec votre mot de passe pour l’activer' }}
              </p>
            </ion-label>
            <ion-toggle
              slot="end"
              class="app-toggle"
              :checked="biometricSaved"
              :disabled="!biometricSaved"
              aria-label="Connexion biométrique"
              @ion-change="disableBiometric"
            ></ion-toggle>
          </ion-item>
        </ion-list>

        <p class="section-title">Hors ligne</p>
        <ion-list class="detail-block settings-list" lines="full">
          <ion-item class="settings-row">
            <ion-label class="ion-text-wrap">
              <p class="srow-label">File d'attente pointage</p>
              <p class="srow-sub">Pointages enregistrés localement, en attente d'envoi</p>
            </ion-label>
            <ion-note slot="end" class="srow-value">{{ pendingCount }}</ion-note>
          </ion-item>

          <!-- N'apparaît que s'il y a quelque chose à signaler : une ligne à
               zéro en permanence ferait du bruit et finirait ignorée — ce qui
               est exactement ce qu'on veut éviter pour ces pointages-là. -->
          <ion-item v-if="failedPointages" class="settings-row">
            <ion-label class="ion-text-wrap">
              <p class="srow-label">Pointages refusés</p>
              <p class="srow-sub">
                Non enregistrés par le serveur, conservés ici — signalez-les à
                votre responsable pour qu'ils soient repris à la main.
              </p>
            </ion-label>
            <ion-note slot="end" class="srow-value srow-alert">{{ failedPointages }}</ion-note>
          </ion-item>
        </ion-list>

        <!-- Même principe que les pointages refusés : rien à afficher tant
             qu'il n'y a rien à signaler. Un plantage était jusqu'ici invisible
             de bout en bout ; le transmettre depuis ici est aujourd'hui le
             seul chemin pour qu'il soit corrigé. -->
        <template v-if="errorsLogged">
          <p class="section-title">Diagnostic</p>
          <ion-list class="detail-block settings-list" lines="full">
            <ion-item class="settings-row">
              <ion-label class="ion-text-wrap">
                <p class="srow-label">Incidents enregistrés</p>
                <p class="srow-sub">
                  Anomalies techniques relevées sur cet appareil. Rien n'est
                  envoyé automatiquement — transmettez-les pour qu'elles soient
                  corrigées.
                </p>
              </ion-label>
              <ion-note slot="end" class="srow-value">{{ errorsLogged }}</ion-note>
            </ion-item>
          </ion-list>
          <div class="detail-block" style="padding: 0 18px;">
            <div class="server-url-actions">
              <ion-button class="server-url-save" expand="block" @click="shareErrorLog">
                Transmettre le diagnostic
              </ion-button>
              <ion-button class="server-url-reset" expand="block" fill="clear" @click="forgetErrorLog">
                Effacer
              </ion-button>
            </div>
          </div>
        </template>

        <template v-if="showServerSetting">
          <p class="section-title">Serveur</p>
          <div class="detail-block" style="padding: 0 18px;">
            <div class="server-url-field">
              <ion-input
                v-model="serverUrlInput"
                type="url"
                inputmode="url"
                fill="outline"
                placeholder="https://exemple.odoo.com"
                autocapitalize="none"
                autocomplete="off"
              ></ion-input>
              <p class="srow-sub">
                Valeur par défaut : {{ defaultServerUrl }}
                <template v-if="serverUrlOverridden"> · personnalisée actuellement</template>
              </p>
              <p v-if="serverUrlError" class="server-url-error">{{ serverUrlError }}</p>
              <p class="srow-sub">Changer cette valeur vous déconnectera (le jeton de session n'est valable que sur le serveur d'origine).</p>
              <div class="server-url-actions">
                <ion-button
                  class="server-url-save"
                  expand="block"
                  :disabled="!serverUrlChanged || savingServerUrl"
                  @click="saveServerUrl"
                >
                  Enregistrer et se reconnecter
                </ion-button>
                <ion-button
                  v-if="serverUrlOverridden"
                  class="server-url-reset"
                  fill="clear"
                  :disabled="savingServerUrl"
                  @click="resetServerUrl"
                >
                  Revenir à la valeur par défaut
                </ion-button>
              </div>
            </div>
          </div>
        </template>

        <p class="section-title">Compte</p>
        <ion-list class="menu" lines="none">
          <ion-item class="menu-item" button :detail="false" color="danger" @click="logout">
            <ion-icon slot="start" :icon="logOutOutline"></ion-icon>
            <ion-label>Déconnexion</ion-label>
          </ion-item>
        </ion-list>
      </template>
    </ion-content>
  </ion-page>
</template>

<style scoped>
.profile-header {
  display: flex;
  flex-direction: column;
  align-items: center;
  padding: 24px 16px 16px;
}

.profile-avatar {
  width: 64px;
  height: 64px;
  border-radius: 50%;
  background: var(--accent-bg);
  color: var(--accent-text);
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 20px;
  font-weight: 500;
  margin-bottom: 10px;
}

.profile-name {
  font-size: 16px;
  font-weight: 500;
  margin: 0;
}

.settings-list {
  --ion-item-background: transparent;
  background: transparent;
  border-radius: 12px;
  overflow: hidden;
}

.settings-row {
  --background: var(--surface-1);
  --border-color: var(--border);
  --padding-start: 18px;
  --inner-padding-end: 18px;
}

.srow-label {
  font-size: 13px;
  margin: 0;
}

.srow-sub {
  font-size: 11px;
  color: var(--text-secondary);
  margin: 2px 0 0;
}

.srow-value {
  font-size: 13px;
  color: var(--text-secondary);
}

/* Les pointages refusés portent une couleur d'alerte : le compteur voisin
   (file d'attente) est une information neutre, celui-ci demande une action.
   Les deux tokens sont redéfinis en thème sombre, donc pas de #hex ici. */
.srow-alert {
  color: var(--danger);
  font-weight: 600;
}

/* ion-toggle : le comportement (piste, poignée, animation, disabled,
   `prefers-reduced-motion`) vient d'Ionic — seule la couleur suit la palette
   Ocleaneo au lieu du bleu par défaut. */
.app-toggle {
  --track-background: var(--border-strong);
  --track-background-checked: var(--accent);
  --handle-background: var(--surface-2);
  --handle-background-checked: var(--surface-2);
  flex-shrink: 0;
}

.menu {
  padding: 0 16px;
  background: transparent;
}

.menu-item {
  --background: transparent;
  --color: var(--danger);
  --padding-start: 4px;
  --inner-padding-end: 4px;
  border-radius: 10px;
  font-size: 14px;
}

.menu-item ion-icon {
  color: var(--danger);
}

.server-url-field {
  padding: 12px 0;
}

.server-url-field ion-input {
  --background: var(--surface-1);
  --border-color: var(--border);
  --border-radius: 10px;
  --color: var(--text-primary);
  --padding-start: 12px;
  --padding-end: 12px;
  font-size: 13px;
}

.server-url-field .srow-sub {
  margin: 6px 0 0;
}

.server-url-error {
  color: var(--danger);
  font-size: 11px;
  margin: 6px 0 0;
}

.server-url-actions {
  display: flex;
  flex-direction: column;
  gap: 8px;
  margin-top: 12px;
}

.server-url-save {
  --border-radius: 10px;
  --background: var(--accent);
  --color: var(--on-accent);
  --box-shadow: none;
  font-weight: 500;
  font-size: 13px;
  text-transform: none;
  margin: 0;
}

.server-url-reset {
  --color: var(--text-secondary);
  font-size: 12px;
  text-decoration: underline;
  margin: 0;
}
</style>
