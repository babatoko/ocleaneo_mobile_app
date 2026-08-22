<script setup>
import AppHeader from '../../components/AppHeader.vue';
</script>

<template>
  <AppHeader title="Administration" />
  <div class="menu">
    <RouterLink to="/admin/planning" class="item">📅 Gérer le planning</RouterLink>
    <RouterLink to="/admin/salaries" class="item">👥 Gérer les salariés</RouterLink>
    <RouterLink to="/admin/chantiers" class="item">🏗️ Gérer les chantiers</RouterLink>
    <RouterLink to="/admin/produits" class="item">🧴 Gérer les produits</RouterLink>
  </div>
</template>

<style scoped>
.menu {
  padding: 16px;
  display: flex;
  flex-direction: column;
  gap: 10px;
}

.item {
  padding: 16px;
  background: var(--surface);
  border: 1px solid var(--border);
  border-radius: 12px;
  text-decoration: none;
  color: var(--text);
  font-weight: 600;
}
</style>
