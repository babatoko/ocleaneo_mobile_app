<script setup lang="ts">
import { IonButton } from '@ionic/vue';

const props = defineProps({
  modelValue: { type: Number, default: 0 },
  min: { type: Number, default: 0 },
  /** Nom du produit, pour des libellés Retirer un/Ajouter un explicites. */
  label: { type: String, default: '' },
});
const emit = defineEmits(['update:modelValue']);

function step(delta: number) {
  const next = Math.max(props.min, props.modelValue + delta);
  emit('update:modelValue', next);
}
</script>

<template>
  <div class="stepper">
    <ion-button
      class="step-btn"
      fill="outline"
      shape="round"
      :aria-label="label ? `Retirer un ${label}` : 'Retirer'"
      @click="step(-1)"
    >−</ion-button>
    <span aria-live="polite" :aria-label="label ? `${modelValue} ${label}` : undefined">{{ modelValue }}</span>
    <ion-button
      class="step-btn"
      fill="outline"
      shape="round"
      :aria-label="label ? `Ajouter un ${label}` : 'Ajouter'"
      @click="step(1)"
    >+</ion-button>
  </div>
</template>

<style scoped>
.stepper {
  display: flex;
  align-items: center;
  gap: 10px;
}

.step-btn {
  /* 44 px = cible tactile HIG/M3 : le stepper est le geste le plus répété
     du flux commande, souvent avec des gants sur le chantier. 32 px
     demandait une précision incompatible. */
  width: 44px;
  height: 44px;
  --padding-start: 0;
  --padding-end: 0;
  --padding-top: 0;
  --padding-bottom: 0;
  --border-color: var(--border);
  --color: var(--text-primary);
  --box-shadow: none;
  font-size: 18px;
  margin: 0;
}

span {
  min-width: 32px;
  text-align: center;
  font-weight: 600;
}
</style>
