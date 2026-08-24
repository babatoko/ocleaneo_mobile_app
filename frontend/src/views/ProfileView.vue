<script setup>
import { computed, onMounted, ref } from 'vue';
import { useRouter } from 'vue-router';
import { provider } from '../providers';
import { useAuthStore } from '../stores/auth';
import {
  clearSavedCredentials,
  hasSavedCredentials,
  isBiometricAvailable,
} from '../services/biometric';
import { areNotificationsEnabled, setNotificationsEnabled } from '../services/notifications';
import { queueLength } from '../services/offlineQueue';

const auth = useAuthStore();
const router = useRouter();

const biometricAvailable = ref(false);
const biometricSaved = ref(false);
const notificationsEnabled = ref(true);
const pendingCount = ref(0);
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
  } finally {
    loading.value = false;
  }
});

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

function isValidUrl(value) {
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
  <div class="profile-header">
    <div class="profile-avatar">{{ initials || '?' }}</div>
    <p class="profile-name">{{ auth.employee?.name || 'Salarié' }}</p>
  </div>

  <template v-if="!loading">
    <p class="section-title">Paramètres</p>
    <div class="detail-block" style="padding: 0 18px;">
      <div class="settings-row">
        <div>
          <p class="srow-label">Notifications</p>
          <p class="srow-sub">Chantier en cours, rappels de vacation, changements de planning</p>
        </div>
        <button
          type="button"
          class="toggle"
          :class="{ off: !notificationsEnabled }"
          role="switch"
          :aria-checked="notificationsEnabled"
          aria-label="Notifications"
          @click="toggleNotifications"
        ></button>
      </div>

      <div v-if="biometricAvailable" class="settings-row">
        <div>
          <p class="srow-label">Connexion biométrique</p>
          <p class="srow-sub">
            {{ biometricSaved ? 'Activée à la dernière connexion' : 'Reconnectez-vous avec votre mot de passe pour l’activer' }}
          </p>
        </div>
        <button
          type="button"
          class="toggle"
          :class="{ off: !biometricSaved }"
          :disabled="!biometricSaved"
          role="switch"
          :aria-checked="biometricSaved"
          aria-label="Connexion biométrique"
          @click="disableBiometric"
        ></button>
      </div>
    </div>

    <p class="section-title">Hors ligne</p>
    <div class="detail-block" style="padding: 0 18px;">
      <div class="settings-row">
        <div>
          <p class="srow-label">File d'attente pointage</p>
          <p class="srow-sub">Pointages enregistrés localement, en attente d'envoi</p>
        </div>
        <span class="srow-value">{{ pendingCount }}</span>
      </div>
    </div>

    <template v-if="showServerSetting">
      <p class="section-title">Serveur</p>
      <div class="detail-block" style="padding: 0 18px;">
        <div class="server-url-field">
          <input
            v-model="serverUrlInput"
            type="url"
            inputmode="url"
            placeholder="https://exemple.odoo.com"
            autocapitalize="none"
            autocomplete="off"
          />
          <p class="srow-sub">
            Valeur par défaut : {{ defaultServerUrl }}
            <template v-if="serverUrlOverridden"> · personnalisée actuellement</template>
          </p>
          <p v-if="serverUrlError" class="server-url-error">{{ serverUrlError }}</p>
          <p class="srow-sub">Changer cette valeur vous déconnectera (le jeton de session n'est valable que sur le serveur d'origine).</p>
          <div class="server-url-actions">
            <button
              type="button"
              class="server-url-save"
              :disabled="!serverUrlChanged || savingServerUrl"
              @click="saveServerUrl"
            >
              Enregistrer et se reconnecter
            </button>
            <button
              v-if="serverUrlOverridden"
              type="button"
              class="server-url-reset"
              :disabled="savingServerUrl"
              @click="resetServerUrl"
            >
              Revenir à la valeur par défaut
            </button>
          </div>
        </div>
      </div>
    </template>

    <p class="section-title">Compte</p>
    <div class="menu">
      <button type="button" class="menu-item danger no-chev" @click="logout">
        <i class="ti ti-logout"></i>
        <span>Déconnexion</span>
      </button>
    </div>
  </template>
</template>
