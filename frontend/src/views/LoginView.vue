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
  <div class="login">
    <h1>Ocleaneo</h1>
    <p>Entrez votre code salarié pour continuer.</p>
    <form @submit.prevent="submit">
      <input v-model="loginCode" placeholder="Code (ex: ABC123)" autocapitalize="characters" required />
      <button type="submit" :disabled="loading">{{ loading ? 'Connexion…' : 'Se connecter' }}</button>
    </form>
    <p v-if="error" class="error">{{ error }}</p>
  </div>
</template>

<style scoped>
.login {
  padding: 32px 24px;
  display: flex;
  flex-direction: column;
  gap: 12px;
  min-height: 100svh;
  justify-content: center;
}

h1 {
  color: var(--primary);
  margin: 0;
}

form {
  display: flex;
  flex-direction: column;
  gap: 12px;
  margin-top: 12px;
}

input {
  padding: 12px;
  border: 1px solid var(--border);
  border-radius: 8px;
  text-transform: uppercase;
}

button {
  padding: 12px;
  border: none;
  border-radius: 8px;
  background: var(--primary);
  color: white;
  font-weight: 600;
}

.error {
  color: var(--danger);
}
</style>
