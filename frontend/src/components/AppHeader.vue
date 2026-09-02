<script setup lang="ts">
import { IonBackButton, IonButtons, IonHeader, IonTitle, IonToolbar } from '@ionic/vue';
import { useRoute } from 'vue-router';
import HelpButton from './HelpButton.vue';

defineProps({
  title: { type: String, required: true },
});

// Le centre d'aide lui-même utilise aussi AppHeader (pour son bouton retour) :
// s'y afficher un lien vers soi-même n'apporte rien.
const route = useRoute();
</script>

<template>
  <ion-header class="app-header">
    <ion-toolbar>
      <ion-buttons slot="start">
        <ion-back-button default-href="/planning" text=""></ion-back-button>
      </ion-buttons>
      <ion-title>{{ title }}</ion-title>
      <ion-buttons v-if="route.path !== '/aide'" slot="end">
        <HelpButton />
      </ion-buttons>
    </ion-toolbar>
  </ion-header>
</template>

<style scoped>
/* Ionic gère nativement le geste de retour et la safe-area de l'en-tête ;
   seule l'identité visuelle Ocleaneo (fond, bordure, typo) reste custom. */
.app-header ion-toolbar {
  --background: var(--surface-2);
  --border-color: var(--border);
  --color: var(--text-primary);
}

.app-header ion-title {
  font-size: 15px;
  font-weight: 500;
  padding-inline: 0;
}

.app-header ion-back-button {
  --color: var(--text-primary);
  --icon-font-size: 20px;
}
</style>
