<script setup lang="ts">
defineProps({
  title: { type: String, required: true },
});
</script>

<template>
  <header class="app-header">
    <button v-if="$router.options.history.state.back" class="back" @click="$router.back()">
      <i class="ti ti-arrow-left"></i>
    </button>
    <h1>{{ title }}</h1>
  </header>
</template>
