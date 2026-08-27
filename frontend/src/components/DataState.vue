<script setup lang="ts">
import { IonButton, IonIcon, IonSkeletonText } from '@ionic/vue';
import { cloudOfflineOutline, informationCircleOutline, refreshOutline } from 'ionicons/icons';

/**
 * États d'un écran alimenté par des données distantes : chargement,
 * indisponibilité, erreur, vide, contenu. Existe pour qu'aucun écran ne
 * puisse plus afficher « vide » alors que le chargement a échoué — un vide
 * et une panne réseau ne veulent pas dire la même chose pour le salarié, et
 * l'un des deux mérite un bouton Réessayer.
 *
 * `unavailable` est un cas distinct d'`error` : le serveur configuré ne
 * couvre pas cette fonctionnalité (voir DataProvider.supports). Rien n'est
 * en panne et réessayer n'y changera rien — donc pas de bouton Réessayer,
 * proposer une action sans effet serait mensonger. Passe avant `error`
 * dans le rendu : une indisponibilité connue explique mieux qu'une erreur.
 */
defineProps({
  loading: { type: Boolean, default: false },
  error: { type: String, default: '' },
  unavailable: { type: String, default: '' },
  empty: { type: Boolean, default: false },
  /** Nombre de cartes fantômes affichées pendant le chargement. */
  skeletonCount: { type: Number, default: 3 },
});

defineEmits(['retry']);
</script>

<template>
  <div v-if="loading" class="ds-skeletons" aria-busy="true" aria-live="polite">
    <span class="sr-only">Chargement en cours…</span>
    <ion-skeleton-text v-for="i in skeletonCount" :key="i" class="ds-skeleton" animated></ion-skeleton-text>
  </div>

  <div v-else-if="unavailable" class="ds-unavailable" role="status">
    <ion-icon :icon="informationCircleOutline" aria-hidden="true"></ion-icon>
    <p class="ds-msg">{{ unavailable }}</p>
    <p class="ds-hint">
      <slot name="unavailable-hint">
        Le planning et le pointage fonctionnent normalement.
      </slot>
    </p>
  </div>

  <div v-else-if="error" class="ds-error" role="alert">
    <ion-icon :icon="cloudOfflineOutline" aria-hidden="true"></ion-icon>
    <p class="ds-msg">{{ error }}</p>
    <ion-button class="ds-retry" fill="solid" size="small" @click="$emit('retry')">
      <ion-icon slot="start" :icon="refreshOutline"></ion-icon>
      Réessayer
    </ion-button>
  </div>

  <p v-else-if="empty" class="ds-empty">
    <slot name="empty">Rien à afficher.</slot>
  </p>

  <slot v-else />
</template>

<style scoped>
.ds-skeletons {
  display: flex;
  flex-direction: column;
  gap: 10px;
  padding: 8px 18px;
}

.ds-skeleton {
  height: 76px;
  border-radius: 12px;
  --background: var(--surface-1);
  --background-rgb: 0, 0, 0;
}

.ds-error,
.ds-unavailable {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 4px;
  padding: 40px 28px;
  text-align: center;
}

.ds-error ion-icon,
.ds-unavailable ion-icon {
  font-size: 30px;
  color: var(--text-muted);
}

.ds-hint {
  font-size: 12.5px;
  color: var(--text-muted);
  margin: 10px 0 0;
  max-width: 30ch;
}

.ds-msg {
  font-size: 13.5px;
  color: var(--text-secondary);
  margin: 6px 0 0;
}

.ds-retry {
  margin-top: 14px;
  --background: var(--accent-bg);
  --color: var(--accent-text);
  --border-radius: 10px;
  --box-shadow: none;
  font-size: 13px;
  font-weight: 500;
  text-transform: none;
}

.ds-empty {
  text-align: center;
  color: var(--text-muted);
  font-size: 13.5px;
  margin: 32px 18px;
}
</style>
