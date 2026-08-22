<script setup>
import { ref } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import { useAuthStore } from '../stores/auth';

const loginCode = ref('');
const error = ref('');
const loading = ref(false);

const auth = useAuthStore();
const router = useRouter();
const route = useRoute();

async function submit() {
  error.value = '';
  loading.value = true;
  try {
    await auth.login(loginCode.value);
    router.replace(route.query.redirect || '/');
  } catch (e) {
    error.value = e.response?.data?.error || 'Connexion impossible';
  } finally {
    loading.value = false;
  }
}
</script>

<template>
  <div class="login-screen">
    <div class="login-logo"><i class="ti ti-sparkles"></i></div>
    <p class="login-title">Bonjour</p>
    <p class="login-sub">Connectez-vous avec votre code salarié</p>

    <form class="login-form" @submit.prevent="submit">
      <input v-model="loginCode" placeholder="Code (ex : ABC123)" autocapitalize="characters" required />
      <button type="submit" :disabled="loading">{{ loading ? 'Connexion…' : 'Se connecter' }}</button>
    </form>
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
  text-transform: uppercase;
  text-align: center;
  letter-spacing: 0.06em;
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
  margin-top: 12px;
}
</style>
