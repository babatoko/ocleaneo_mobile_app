<script setup>
import { onMounted, ref } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import { useAuthStore } from '../stores/auth';
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

function afterLogin(loggedInUsername) {
  localStorage.setItem(LAST_USERNAME_KEY, loggedInUsername);
  router.replace(route.query.redirect || '/');
}

async function tryBiometric() {
  error.value = '';
  loading.value = true;
  try {
    const creds = await getSavedCredentials();
    await auth.login(creds.username, creds.password);
    afterLogin(creds.username);
  } catch {
    error.value = "Authentification par empreinte annulée ou impossible.";
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
    afterLogin(username.value);
  } catch (e) {
    error.value = e.response?.data?.error || 'Identifiants incorrects';
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
  color: white;
  font-weight: 500;
}

.error {
  color: var(--danger);
  font-size: 13px;
  margin-top: 16px;
}
</style>
