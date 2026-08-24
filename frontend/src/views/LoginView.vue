<script setup>
import { onMounted, ref } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import { useAuthStore } from '../stores/auth';
import { usePointageStore } from '../stores/pointage';
import {
  clearSavedCredentials,
  getSavedCredentials,
  hasSavedCredentials,
  isBiometricAvailable,
  saveCredentials,
} from '../services/biometric';

const LAST_USERNAME_KEY = 'ocleaneo_last_username';

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
function loginErrorMessage(e) {
  if (e.isNetworkError) return 'Pas de connexion — vérifiez votre réseau puis réessayez.';
  if (e.status === 401 || e.status === 403) return 'Identifiants incorrects.';
  return e.message || 'Connexion impossible pour le moment.';
}

async function afterLogin(loggedInUsername) {
  localStorage.setItem(LAST_USERNAME_KEY, loggedInUsername);
  if (pointage.pendingTagUid) {
    // L'app vient d'être ouverte par ce badge : on traite la lecture en
    // attente au lieu d'atterrir sur le planning.
    await pointage.consumePendingTag(router);
    return;
  }
  router.replace(route.query.redirect || '/planning');
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
    error.value = e.isNetworkError
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

async function submit() {
  error.value = '';
  loading.value = true;
  try {
    await auth.login(username.value, password.value);
    if (biometricAvailable.value) {
      await saveCredentials(username.value, password.value);
    }
    await afterLogin(username.value);
  } catch (e) {
    error.value = loginErrorMessage(e);
  } finally {
    loading.value = false;
  }
}
</script>

<template>
  <div class="login-screen">
    <div class="login-logo"><i class="ti ti-sparkles"></i></div>

    <template v-if="mode === 'biometric'">
      <p class="login-title">Bonjour</p>
      <p class="login-sub">Connectez-vous pour continuer</p>

      <button class="fingerprint-circle" :disabled="loading" @click="tryBiometric">
        <i class="ti ti-fingerprint"></i>
      </button>
      <p class="login-hint">Posez votre doigt sur le capteur</p>
      <p class="login-name">{{ rememberedUsername }}</p>

      <button class="login-alt" @click="usePassword">
        <i class="ti ti-lock"></i> Utiliser le mot de passe
      </button>
      <button class="login-alt" @click="forgetBiometric">Ce n'est pas vous ?</button>
    </template>

    <template v-else>
      <p class="login-title">Bonjour</p>
      <p class="login-sub">Connectez-vous avec vos identifiants</p>

      <form class="login-form" @submit.prevent="submit">
        <input v-model="username" placeholder="Identifiant" autocapitalize="none" autocomplete="username" required />
        <input v-model="password" type="password" placeholder="Mot de passe" autocomplete="current-password" required />
        <button type="submit" :disabled="loading">{{ loading ? 'Connexion…' : 'Se connecter' }}</button>
      </form>

      <p v-if="biometricAvailable" class="login-alt">
        <i class="ti ti-fingerprint"></i> L'empreinte sera proposée à la prochaine connexion
      </p>
    </template>

    <p v-if="error" class="error">{{ error }}</p>
  </div>
</template>

<style scoped>
.login-form {
  width: 100%;
  display: flex;
  flex-direction: column;
  gap: 10px;
}

.login-form input {
  padding: 13px 14px;
  border: 1px solid var(--border);
  border-radius: 10px;
}

.login-form button {
  padding: 13px;
  border: none;
  border-radius: 10px;
  background: var(--accent);
  color: var(--on-accent);
  font-weight: 500;
}

.error {
  color: var(--danger);
  font-size: 13px;
  margin-top: 16px;
}
</style>
