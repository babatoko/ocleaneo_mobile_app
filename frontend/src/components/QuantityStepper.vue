<script setup lang="ts">
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
    <button type="button" @click="step(-1)">−</button>
    <span>{{ modelValue }}</span>
    <button type="button" @click="step(1)">+</button>
  </div>
</template>

<style scoped>
.stepper {
  display: flex;
  align-items: center;
  gap: 10px;
}

button {
  width: 32px;
  height: 32px;
  border-radius: 50%;
  border: 1px solid var(--border);
  background: var(--surface);
  font-size: 18px;
  line-height: 1;
}

span {
  min-width: 24px;
  text-align: center;
  font-weight: 600;
}
</style>
