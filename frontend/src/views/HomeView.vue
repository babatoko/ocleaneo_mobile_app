<script setup>
import { onMounted } from 'vue';
import { useAuthStore } from '../stores/auth';

const auth = useAuthStore();

onMounted(() => {
  if (!auth.employee) auth.fetchMe();
});
</script>

<template>
  <div class="home">
    <h1>Bonjour {{ auth.employee?.name || '' }} 👋</h1>
    <div class="menu">
      <RouterLink to="/commande/chantier" class="tile">🛒<span>Commander</span></RouterLink>
      <RouterLink to="/inventaire" class="tile">📦<span>Inventaire</span></RouterLink>
      <RouterLink to="/historique" class="tile">🕓<span>Historique</span></RouterLink>
      <RouterLink v-if="auth.isAdmin" to="/admin" class="tile">⚙️<span>Admin</span></RouterLink>
    </div>
  </div>
</template>

<style scoped>
.home {
  padding: 24px;
}

.menu {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 16px;
  margin-top: 24px;
}

.tile {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 8px;
  padding: 32px 16px;
  background: var(--surface);
  border: 1px solid var(--border);
  border-radius: 16px;
  font-size: 36px;
  text-decoration: none;
  color: var(--text);
}

.tile span {
  font-size: 14px;
  font-weight: 600;
}
</style>
