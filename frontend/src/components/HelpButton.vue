<script setup lang="ts">
import { IonIcon } from '@ionic/vue';
import { helpCircleOutline } from 'ionicons/icons';
import { useRouter } from 'vue-router';

const router = useRouter();
</script>

<template>
  <button type="button" class="help-fab" aria-label="Aide" @click="router.push('/aide')">
    <ion-icon :icon="helpCircleOutline" aria-hidden="true"></ion-icon>
  </button>
</template>

<style scoped>
/* Volontairement discret : un contour fin plutôt qu'un aplat de couleur, pour
   ne jamais rivaliser avec les vraies actions de l'écran (avatar, statut de
   pointage...). Il ne se colore qu'au survol/focus. */
.help-fab {
  width: 32px;
  height: 32px;
  border-radius: 50%;
  border: 1.4px solid var(--border-strong);
  background: var(--surface-2);
  color: var(--text-secondary);
  display: flex;
  align-items: center;
  justify-content: center;
  flex-shrink: 0;
  padding: 0;
  cursor: pointer;
}

.help-fab ion-icon {
  font-size: 17px;
}

.help-fab:hover,
.help-fab:focus-visible {
  border-color: var(--accent);
  color: var(--accent);
  background: var(--accent-bg);
}

.help-fab:focus-visible {
  outline: 2px solid var(--accent);
  outline-offset: 2px;
}
</style>
