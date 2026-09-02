<script setup lang="ts">
import { computed, watch } from 'vue';
import { useRoute } from 'vue-router';
import { IonApp, IonRouterOutlet } from '@ionic/vue';
import { useAuthStore } from './stores/auth';
import { useOnboardingStore } from './stores/onboarding';
import BottomNav from './components/BottomNav.vue';
import OnboardingTour from './components/OnboardingTour.vue';

const route = useRoute();
const auth = useAuthStore();
const onboarding = useOnboardingStore();
const showNav = computed(() => auth.isAuthenticated && !route.meta.public);

// L'employé n'est connu qu'après fetchMe() (voir router/guard.ts) — jamais
// juste après login(). Le drapeau « déjà vu » (Preferences, par employee.id)
// reste la seule source de vérité : ce watcher se redéclenche à chaque
// démarrage tant que l'app reste connectée, sans jamais rejouer le tour pour
// un employé qui l'a déjà terminé ou passé.
watch(
  () => auth.employee?.id,
  (id) => {
    if (id) onboarding.maybeStartForCurrentEmployee();
  },
  { immediate: true },
);
</script>

<template>
  <ion-app>
    <ion-router-outlet />
    <BottomNav v-if="showNav" />
    <OnboardingTour v-if="showNav" />
  </ion-app>
</template>
