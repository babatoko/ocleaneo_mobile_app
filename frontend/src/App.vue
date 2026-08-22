<script setup>
import { computed } from 'vue';
import { useRoute } from 'vue-router';
import { useAuthStore } from './stores/auth';
import BottomNav from './components/BottomNav.vue';

const route = useRoute();
const auth = useAuthStore();
const showNav = computed(() => auth.isAuthenticated && !route.meta.public);
</script>

<template>
  <main class="page">
    <RouterView />
  </main>
  <BottomNav v-if="showNav" />
</template>

<style scoped>
.page {
  flex: 1;
  overflow-y: auto;
  padding-bottom: 72px;
}
</style>
