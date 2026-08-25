<script setup lang="ts">
import { IonButton } from '@ionic/vue';

const props = defineProps({
  modelValue: { type: Number, default: 0 },
  min: { type: Number, default: 0 },
});
const emit = defineEmits(['update:modelValue']);

function step(delta: number) {
  const next = Math.max(props.min, props.modelValue + delta);
  emit('update:modelValue', next);
}
</script>

<template>
  <div class="stepper">
    <ion-button class="step-btn" fill="outline" shape="round" @click="step(-1)">−</ion-button>
    <span>{{ modelValue }}</span>
    <ion-button class="step-btn" fill="outline" shape="round" @click="step(1)">+</ion-button>
  </div>
</template>

<style scoped>
.stepper {
  display: flex;
  align-items: center;
  gap: 10px;
}

.step-btn {
  width: 32px;
  height: 32px;
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
  min-width: 24px;
  text-align: center;
  font-weight: 600;
}
</style>
