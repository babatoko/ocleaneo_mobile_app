<script setup>
import { useAuthStore } from '../stores/auth';

const auth = useAuthStore();
</script>

<template>
  <nav class="bottom-nav">
    <RouterLink to="/planning" class="nav-item"><i class="ti ti-calendar"></i><span class="lbl">Planning</span></RouterLink>
    <RouterLink to="/pointage" class="nav-item"><i class="ti ti-clock"></i><span class="lbl">Pointage</span></RouterLink>
    <RouterLink to="/commande/catalogue" class="nav-item"><i class="ti ti-shopping-cart"></i><span class="lbl">Commande</span></RouterLink>
    <RouterLink to="/historique" class="nav-item"><i class="ti ti-history"></i><span class="lbl">Historique</span></RouterLink>
    <RouterLink to="/profil" class="nav-item"><i class="ti ti-user"></i><span class="lbl">Profil</span></RouterLink>
  </nav>
</template>
