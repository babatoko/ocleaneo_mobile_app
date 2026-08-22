<script setup>
defineProps({
  title: { type: String, required: true },
});
</script>

<template>
  <header class="app-header">
    <button v-if="$router.options.history.state.back" class="back" @click="$router.back()">←</button>
    <h1>{{ title }}</h1>
  </header>
</template>

<style scoped>
.app-header {
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 16px;
  background: var(--surface);
  border-bottom: 1px solid var(--border);
  position: sticky;
  top: 0;
  z-index: 5;
}

.back {
  border: none;
  background: none;
  font-size: 20px;
  color: var(--text);
  padding: 0;
}

h1 {
  font-size: 18px;
  margin: 0;
}
</style>
