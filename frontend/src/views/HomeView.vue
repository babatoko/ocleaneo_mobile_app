<script setup>
import { computed, onMounted } from 'vue';
import { useAuthStore } from '../stores/auth';

const auth = useAuthStore();

onMounted(() => {
  if (!auth.employee) auth.fetchMe();
});

const initials = computed(() =>
  (auth.employee?.name || '')
    .split(' ')
    .map((p) => p[0])
    .slice(0, 2)
    .join('')
    .toUpperCase()
);
</script>

<template>
  <div class="header">
    <div>
      <p class="hello">Bonjour</p>
      <p class="name">{{ auth.employee?.name || '' }}</p>
    </div>
    <div class="avatar">{{ initials }}</div>
  </div>

  <div class="menu-grid">
    <RouterLink to="/planning" class="tile"><i class="ti ti-calendar"></i><span>Planning</span></RouterLink>
    <RouterLink to="/pointage" class="tile"><i class="ti ti-clock"></i><span>Pointage</span></RouterLink>
    <RouterLink to="/commande/catalogue" class="tile"><i class="ti ti-shopping-cart"></i><span>Commander</span></RouterLink>
    <RouterLink to="/inventaire" class="tile"><i class="ti ti-package"></i><span>Inventaire</span></RouterLink>
    <RouterLink to="/historique" class="tile"><i class="ti ti-history"></i><span>Historique</span></RouterLink>
    <RouterLink v-if="auth.isAdmin" to="/admin" class="tile"><i class="ti ti-settings"></i><span>Admin</span></RouterLink>
  </div>
</template>

<style scoped>
.menu-grid {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 12px;
  padding: 8px 18px 18px;
}

.tile {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 10px;
  padding: 26px 12px;
  background: var(--surface-1);
  border-radius: 14px;
  text-decoration: none;
  color: var(--text-primary);
}

.tile i {
  font-size: 26px;
  color: var(--accent-text);
}

.tile span {
  font-size: 13px;
  font-weight: 500;
}
</style>
