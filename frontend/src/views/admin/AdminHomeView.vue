<script setup>
import AppHeader from '../../components/AppHeader.vue';
</script>

<template>
  <AppHeader title="Administration" />
  <div class="menu">
    <RouterLink to="/admin/planning" class="menu-item">
      <i class="ti ti-calendar"></i><span>Gérer le planning</span><i class="ti ti-chevron-right chev"></i>
    </RouterLink>
    <RouterLink to="/admin/salaries" class="menu-item">
      <i class="ti ti-users"></i><span>Gérer les salariés</span><i class="ti ti-chevron-right chev"></i>
    </RouterLink>
    <RouterLink to="/admin/chantiers" class="menu-item">
      <i class="ti ti-building"></i><span>Gérer les chantiers</span><i class="ti ti-chevron-right chev"></i>
    </RouterLink>
    <RouterLink to="/admin/produits" class="menu-item">
      <i class="ti ti-spray"></i><span>Gérer les produits</span><i class="ti ti-chevron-right chev"></i>
    </RouterLink>
  </div>
</template>
