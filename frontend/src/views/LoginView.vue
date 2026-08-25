<script setup lang="ts">
import { onMounted, ref } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import { IonButton, IonContent, IonIcon, IonInput, IonPage, IonSpinner, alertController } from '@ionic/vue';
import { fingerPrintOutline, lockClosedOutline, sparklesOutline } from 'ionicons/icons';
import { useAuthStore } from '../stores/auth';
import { usePointageStore } from '../stores/pointage';
import { ProviderNetworkError, ProviderError } from '../providers/DataProvider';
import {
  clearSavedCredentials,
  getSavedCredentials,
  hasSavedCredentials,
  isBiometricAvailable,
  saveCredentials,
} from '../services/biometric';

const LAST_USERNAME_KEY = 'ocleaneo_last_username';
const BIOMETRIC_DECLINED_KEY = 'ocleaneo_biometric_declined';

const mode = ref('password'); // 'password' | 'biometric'
const username = ref('');
const password = ref('');
const rememberedUsername = ref('');
const error = ref('');
const loading = ref(false);
const biometricAvailable = ref(false);

const auth = useAuthStore();
const pointage = usePointageStore();
const router = useRouter();
const route = useRoute();

onMounted(async () => {
  biometricAvailable.value = await isBiometricAvailable();
  rememberedUsername.value = localStorage.getItem(LAST_USERNAME_KEY) || '';

  if (biometricAvailable.value && (await hasSavedCredentials())) {
    mode.value = 'biometric';
    tryBiometric();
  }
});

// Un échec de connexion a trois causes très différentes pour le salarié : pas
// de réseau (fréquent en sous-sol/local technique), mauvais identifiants, ou
// serveur en panne. Les confondre sous « Identifiants incorrects » envoie
// l'agent retaper un mot de passe correct.
function loginErrorMessage(e: unknown): string {
  if (e instanceof ProviderNetworkError) return 'Pas de connexion — vérifiez votre réseau puis réessayez.';
  if (e instanceof ProviderError && (e.status === 401 || e.status === 403)) return 'Identifiants incorrects.';
  return e instanceof Error ? e.message || 'Connexion impossible pour le moment.' : 'Connexion impossible pour le moment.';
}

async function afterLogin(loggedInUsername: string) {
  localStorage.setItem(LAST_USERNAME_KEY, loggedInUsername);
  if (pointage.pendingTagUid) {
    // L'app vient d'être ouverte par ce badge : on traite la lecture en
    // attente au lieu d'atterrir sur le planning.
    await pointage.consumePendingTag(router);
    return;
  }
  const redirect = typeof route.query.redirect === 'string' ? route.query.redirect : '/planning';
  router.replace(redirect);
}

async function tryBiometric() {
  error.value = '';
  loading.value = true;
  try {
    const creds = await getSavedCredentials();
    await auth.login(creds.username, creds.password);
    await afterLogin(creds.username);
  } catch (e) {
    // Le réseau peut tomber après une empreinte pourtant valide : ne pas
    // laisser croire que le capteur a échoué.
    error.value = e instanceof ProviderNetworkError
      ? loginErrorMessage(e)
      : "Authentification par empreinte annulée ou impossible.";
  } finally {
    loading.value = false;
  }
}

function usePassword() {
  mode.value = 'password';
  username.value = rememberedUsername.value;
  error.value = '';
}

async function forgetBiometric() {
  await clearSavedCredentials();
  usePassword();
}

/**
 * Propose l'activation de la biométrie plutôt que de sauvegarder le mot de
 * passe sans le dire : sans ce consentement explicite, chaque connexion au
 * mot de passe enregistrait silencieusement les identifiants dans le
 * trousseau natif. On ne le redemande pas si le salarié a déjà refusé une
 * fois (`BIOMETRIC_DECLINED_KEY`) ni s'il a déjà des identifiants enregistrés.
 */
async function maybeOfferBiometric(loggedInUsername: string, loggedInPassword: string) {
  if (!biometricAvailable.value) return;
  if (localStorage.getItem(BIOMETRIC_DECLINED_KEY) === '1') return;
  if (await hasSavedCredentials()) return;

  const alert = await alertController.create({
    header: 'Connexion par empreinte ?',
    message: 'Activez-la pour vous reconnecter plus vite la prochaine fois, sans retaper votre mot de passe.',
    buttons: [
      {
        text: 'Non merci',
        role: 'cancel',
        handler: () => localStorage.setItem(BIOMETRIC_DECLINED_KEY, '1'),
      },
      {
        text: 'Activer',
        handler: () => saveCredentials(loggedInUsername, loggedInPassword),
      },
    ],
  });
  await alert.present();
  await alert.onDidDismiss();
}

async function submit() {
  error.value = '';
  loading.value = true;
  try {
    await auth.login(username.value, password.value);
    await maybeOfferBiometric(username.value, password.value);
    await afterLogin(username.value);
  } catch (e) {
    error.value = loginErrorMessage(e);
  } finally {
    loading.value = false;
  }
}
</script>

<template>
  <ion-page>
    <ion-content class="ion-padding" :fullscreen="true">
      <div class="login-screen">
        <div class="login-logo"><ion-icon :icon="sparklesOutline"></ion-icon></div>

        <template v-if="mode === 'biometric'">
          <p class="login-title">Bonjour</p>
          <p class="login-sub">Connectez-vous pour continuer</p>

          <button class="fingerprint-circle" type="button" :disabled="loading" @click="tryBiometric">
            <ion-spinner v-if="loading" name="crescent"></ion-spinner>
            <ion-icon v-else :icon="fingerPrintOutline"></ion-icon>
          </button>
          <p class="login-hint">Posez votre doigt sur le capteur</p>
          <p class="login-name">{{ rememberedUsername }}</p>

          <button class="login-alt" type="button" @click="usePassword">
            <ion-icon :icon="lockClosedOutline"></ion-icon> Utiliser le mot de passe
          </button>
          <button class="login-alt" type="button" @click="forgetBiometric">Ce n'est pas vous ?</button>
        </template>

        <template v-else>
          <p class="login-title">Bonjour</p>
          <p class="login-sub">Connectez-vous avec vos identifiants</p>

          <form class="login-form" @submit.prevent="submit">
            <ion-input
              v-model="username"
              fill="outline"
              label="Identifiant"
              label-placement="floating"
              autocapitalize="none"
              autocomplete="username"
              required
            ></ion-input>
            <ion-input
              v-model="password"
              type="password"
              fill="outline"
              label="Mot de passe"
              label-placement="floating"
              autocomplete="current-password"
              required
            ></ion-input>
            <ion-button type="submit" expand="block" :disabled="loading">
              <ion-spinner v-if="loading" name="crescent"></ion-spinner>
              <template v-else>Se connecter</template>
            </ion-button>
          </form>

          <p v-if="biometricAvailable" class="login-alt">
            <ion-icon :icon="fingerPrintOutline"></ion-icon> On vous proposera d'activer la connexion par empreinte après la connexion
          </p>
        </template>

        <p v-if="error" class="error">{{ error }}</p>
      </div>
    </ion-content>
  </ion-page>
</template>

<style scoped>
.login-form {
  width: 100%;
  display: flex;
  flex-direction: column;
  gap: 10px;
}

.login-form ion-input {
  --background: var(--surface-2);
  --border-color: var(--border);
  --border-radius: 10px;
  --color: var(--text-primary);
  --padding-start: 14px;
  --padding-end: 14px;
}

.login-form ion-button {
  margin-top: 4px;
  --background: var(--accent);
  --color: var(--on-accent);
  --border-radius: 10px;
  --box-shadow: none;
  font-weight: 500;
  text-transform: none;
}

.error {
  color: var(--danger);
  font-size: 13px;
  margin-top: 16px;
}
</style>
