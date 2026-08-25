<script setup lang="ts">
/**
 * États d'un écran alimenté par des données distantes : chargement, erreur,
 * vide, contenu. Existe pour qu'aucun écran ne puisse plus afficher « vide »
 * alors que le chargement a échoué — un vide et une panne réseau ne veulent
 * pas dire la même chose pour le salarié, et l'un des deux mérite un bouton
 * Réessayer.
 */
defineProps({
  loading: { type: Boolean, default: false },
  error: { type: String, default: '' },
  empty: { type: Boolean, default: false },
  /** Nombre de cartes fantômes affichées pendant le chargement. */
  skeletonCount: { type: Number, default: 3 },
});

defineEmits(['retry']);
</script>

<template>
  <div v-if="loading" class="ds-skeletons" aria-busy="true" aria-live="polite">
    <span class="sr-only">Chargement en cours…</span>
    <div v-for="i in skeletonCount" :key="i" class="ds-skeleton"></div>
  </div>

  <div v-else-if="error" class="ds-error" role="alert">
    <i class="ti ti-cloud-off"></i>
    <p class="ds-msg">{{ error }}</p>
    <button type="button" class="ds-retry" @click="$emit('retry')">
      <i class="ti ti-refresh"></i> Réessayer
    </button>
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
  background: linear-gradient(
    100deg,
    var(--surface-1) 30%,
    var(--skeleton-sheen) 50%,
    var(--surface-1) 70%
  );
  background-size: 300% 100%;
  animation: ds-sheen 1.3s ease-in-out infinite;
}

@keyframes ds-sheen {
  from {
    background-position: 150% 0;
  }
  to {
    background-position: -50% 0;
  }
}

@media (prefers-reduced-motion: reduce) {
  .ds-skeleton {
    animation: none;
  }
}

.ds-error {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 4px;
  padding: 40px 28px;
  text-align: center;
}

.ds-error i {
  font-size: 30px;
  color: var(--text-muted);
}

.ds-msg {
  font-size: 13.5px;
  color: var(--text-secondary);
  margin: 6px 0 0;
}

.ds-retry {
  display: flex;
  align-items: center;
  gap: 6px;
  margin-top: 14px;
  padding: 9px 18px;
  border: none;
  border-radius: 10px;
  background: var(--accent-bg);
  color: var(--accent-text);
  font-size: 13px;
  font-weight: 500;
}

.ds-empty {
  text-align: center;
  color: var(--text-muted);
  font-size: 13.5px;
  margin: 32px 18px;
}
</style>
