<script setup lang="ts">
import { computed } from 'vue';
import { useRoute } from 'vue-router';
import { IonApp, IonRouterOutlet } from '@ionic/vue';
import { useAuthStore } from './stores/auth';
import BottomNav from './components/BottomNav.vue';

const route = useRoute();
const auth = useAuthStore();
const showNav = computed(() => auth.isAuthenticated && !route.meta.public);
</script>

<template>
  <ion-app>
    <ion-router-outlet />
    <BottomNav v-if="showNav" />
  </ion-app>
</template>
