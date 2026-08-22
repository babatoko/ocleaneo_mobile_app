<script setup>
defineProps({
  product: { type: Object, required: true },
});
defineEmits(['select']);
</script>

<template>
  <button type="button" class="product-card" @click="$emit('select', product)">
    <span class="emoji">{{ product.emoji }}</span>
    <span class="name">{{ product.name }}</span>
  </button>
</template>

<style scoped>
.product-card {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 8px;
  padding: 16px 8px;
  background: var(--surface);
  border: 1px solid var(--border);
  border-radius: 12px;
  text-align: center;
}

.emoji {
  font-size: 32px;
}

.name {
  font-size: 13px;
  color: var(--text);
}
</style>
