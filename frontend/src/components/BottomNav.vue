<script setup>
import { useAuthStore } from '../stores/auth';

const auth = useAuthStore();
</script>

<template>
  <nav class="bottom-nav">
    <RouterLink to="/" class="nav-item">🏠<span>Accueil</span></RouterLink>
    <RouterLink to="/commande/chantier" class="nav-item">🛒<span>Commande</span></RouterLink>
    <RouterLink to="/inventaire" class="nav-item">📦<span>Inventaire</span></RouterLink>
    <RouterLink to="/historique" class="nav-item">🕓<span>Historique</span></RouterLink>
    <RouterLink v-if="auth.isAdmin" to="/admin" class="nav-item">⚙️<span>Admin</span></RouterLink>
  </nav>
</template>

<style scoped>
.bottom-nav {
  position: fixed;
  bottom: 0;
  left: 50%;
  transform: translateX(-50%);
  width: 100%;
  max-width: 480px;
  display: flex;
  background: var(--surface);
  border-top: 1px solid var(--border);
  padding: 6px 0 calc(6px + env(safe-area-inset-bottom));
}

.nav-item {
  flex: 1;
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 2px;
  font-size: 11px;
  text-decoration: none;
  color: var(--text-muted);
  padding: 4px 0;
}

.nav-item.router-link-active {
  color: var(--primary);
}
</style>
