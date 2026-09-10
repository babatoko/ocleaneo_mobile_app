<script setup lang="ts">
import { computed, onMounted, ref } from 'vue';
import { useRouter } from 'vue-router';
import {
  IonBackButton,
  IonButton,
  IonContent,
  IonHeader,
  IonIcon,
  IonInput,
  IonItem,
  IonLabel,
  IonList,
  IonPage,
  IonTitle,
  IonToolbar,
} from '@ionic/vue';
import {
  fingerPrintOutline,
  eyeOutline,
  eyeOffOutline,
  logOutOutline,
} from 'ionicons/icons';
import { useAuthStore } from '../stores/auth';
import {
  clearSavedCredentials,
  hasSavedCredentials,
  isBiometricAvailable,
} from '../services/biometric';

const auth = useAuthStore();
const router = useRouter();

const biometricAvailable = ref(false);
const biometricSaved = ref(false);

const currentPassword = ref('');
const newPassword = ref('');
const confirmPassword = ref('');
const showCurrent = ref(false);
const showNew = ref(false);
const showConfirm = ref(false);
const passwordError = ref('');
const passwordSaving = ref(false);

onMounted(async () => {
  biometricAvailable.value = await isBiometricAvailable();
  if (biometricAvailable.value) biometricSaved.value = await hasSavedCredentials();
});

const canSubmitPassword = computed(() =>
  currentPassword.value &&
  newPassword.value &&
  confirmPassword.value &&
  !passwordSaving.value,
);

function validatePassword(): string | null {
  if (newPassword.value.length < 12) return 'Le mot de passe doit contenir au moins 12 caractères.';
  if (!/[A-Z]/.test(newPassword.value)) return 'Le mot de passe doit contenir au moins une majuscule.';
  if (!/[a-z]/.test(newPassword.value)) return 'Le mot de passe doit contenir au moins une minuscule.';
  if (!/[0-9]/.test(newPassword.value)) return 'Le mot de passe doit contenir au moins un chiffre.';
  if (!/[^A-Za-z0-9]/.test(newPassword.value)) return 'Le mot de passe doit contenir au moins un caractère spécial.';
  if (newPassword.value !== confirmPassword.value) return 'Le nouveau mot de passe et la confirmation ne correspondent pas.';
  return null;
}

async function submitPasswordChange() {
  passwordError.value = '';
  if (!currentPassword.value) {
    passwordError.value = 'Veuillez saisir votre mot de passe actuel.';
    return;
  }
  const validation = validatePassword();
  if (validation) {
    passwordError.value = validation;
    return;
  }
  passwordSaving.value = true;
  try {
    await auth.changePassword(currentPassword.value, newPassword.value);
    router.replace('/login');
  } catch (e) {
    passwordError.value = e instanceof Error ? e.message : 'Le changement a échoué.';
  } finally {
    passwordSaving.value = false;
  }
}


async function disableBiometric() {
  if (!biometricSaved.value) return;
  await clearSavedCredentials();
  biometricSaved.value = false;
}

function logout() {
  auth.logout();
  router.replace('/login');
}
</script>

<template>
  <ion-page class="security-page">
    <ion-header class="ion-no-border">
      <ion-toolbar>
        <ion-buttons slot="start">
          <ion-back-button text="Retour" default-href="/profil"></ion-back-button>
        </ion-buttons>
        <ion-title>Sécurité &amp; accès</ion-title>
      </ion-toolbar>
    </ion-header>

    <ion-content>
      <div class="security-content">
        <!-- Password section -->
        <p class="section-title">Mot de passe</p>
        <ion-list class="grouped-list" lines="full">
          <ion-item class="grouped-row password-row">
            <ion-input
              v-model="currentPassword"
              :type="showCurrent ? 'text' : 'password'"
              label="Mot de passe actuel"
              label-placement="stacked"
              placeholder="Votre mot de passe actuel"
              autocomplete="current-password"
            ></ion-input>
            <ion-button
              slot="end"
              fill="clear"
              class="visibility-btn"
              aria-label="Afficher le mot de passe actuel"
              @click="showCurrent = !showCurrent"
            >
              <ion-icon :icon="showCurrent ? eyeOffOutline : eyeOutline" aria-hidden="true"></ion-icon>
            </ion-button>
          </ion-item>

          <ion-item class="grouped-row password-row">
            <ion-input
              v-model="newPassword"
              :type="showNew ? 'text' : 'password'"
              label="Nouveau mot de passe"
              label-placement="stacked"
              placeholder="Min. 12 caractères, majuscule, minuscule, chiffre, spécial"
              autocomplete="new-password"
            ></ion-input>
            <ion-button
              slot="end"
              fill="clear"
              class="visibility-btn"
              aria-label="Afficher le nouveau mot de passe"
              @click="showNew = !showNew"
            >
              <ion-icon :icon="showNew ? eyeOffOutline : eyeOutline" aria-hidden="true"></ion-icon>
            </ion-button>
          </ion-item>

          <ion-item class="grouped-row password-row">
            <ion-input
              v-model="confirmPassword"
              :type="showConfirm ? 'text' : 'password'"
              label="Confirmer le nouveau mot de passe"
              label-placement="stacked"
              placeholder="Saisissez à nouveau le nouveau mot de passe"
              autocomplete="new-password"
            ></ion-input>
            <ion-button
              slot="end"
              fill="clear"
              class="visibility-btn"
              aria-label="Afficher la confirmation"
              @click="showConfirm = !showConfirm"
            >
              <ion-icon :icon="showConfirm ? eyeOffOutline : eyeOutline" aria-hidden="true"></ion-icon>
            </ion-button>
          </ion-item>
        </ion-list>

        <p v-if="passwordError" class="error-text">{{ passwordError }}</p>

        <ion-button
          class="save-btn"
          expand="block"
          :disabled="!canSubmitPassword"
          @click="submitPasswordChange"
        >
          {{ passwordSaving ? 'Enregistrement...' : 'Changer mon mot de passe' }}
        </ion-button>

        <!-- Biometric section -->
        <p v-if="biometricAvailable" class="section-title">Accès</p>
        <ion-list v-if="biometricAvailable" class="grouped-list" lines="full">
          <ion-item class="grouped-row" :button="false" :detail="false">
            <div slot="start" class="row-icon">
              <ion-icon :icon="fingerPrintOutline" aria-hidden="true"></ion-icon>
            </div>
            <ion-label class="ion-text-wrap">
              <p class="row-label">Connexion biométrique</p>
              <p class="row-sub">{{ biometricSaved ? 'Activée sur cet appareil' : 'Activez-la à la prochaine connexion avec votre mot de passe' }}</p>
            </ion-label>
            <ion-toggle
              slot="end"
              class="app-toggle"
              :checked="biometricSaved"
              :aria-label="true"
              @ion-change="biometricSaved ? disableBiometric() : null"
            ></ion-toggle>
          </ion-item>
        </ion-list>

        <!-- Logout -->
        <div class="logout-wrap">
          <ion-button class="logout-btn" expand="block" fill="clear" color="danger" @click="logout">
            <ion-icon slot="start" :icon="logOutOutline"></ion-icon>
            Se déconnecter
          </ion-button>
        </div>
      </div>
    </ion-content>
  </ion-page>
</template>

<style scoped>
.security-content {
  padding: 0 16px calc(24px + env(safe-area-inset-bottom));
}

.section-title {
  font-size: 13px;
  font-weight: 600;
  text-transform: uppercase;
  letter-spacing: 0.4px;
  color: var(--text-secondary);
  margin: 24px 0 8px 6px;
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

.password-row {
  --min-height: 72px;
}

.password-row ion-input {
  --padding-start: 0;
  --padding-end: 0;
}

.password-row ion-input::part(label) {
  font-size: 13px;
  color: var(--text-secondary);
}

.visibility-btn {
  --color: var(--text-secondary);
  --padding-start: 8px;
  --padding-end: 8px;
  margin: 0;
}

.visibility-btn ion-icon {
  font-size: 22px;
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

.app-toggle {
  --track-background: var(--border-strong);
  --track-background-checked: var(--accent);
  --handle-background: var(--surface-2);
  --handle-background-checked: var(--surface-2);
  flex-shrink: 0;
}

.error-text {
  color: var(--danger);
  font-size: 13px;
  margin: 8px 6px 16px;
}

.save-btn {
  --border-radius: 12px;
  --background: var(--accent);
  --color: var(--on-accent);
  --box-shadow: none;
  font-weight: 600;
  font-size: 15px;
  text-transform: none;
  margin: 0 0 16px;
  min-height: 48px;
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
</style>
