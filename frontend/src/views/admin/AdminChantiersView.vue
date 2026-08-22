<script setup>
import { onMounted, ref } from 'vue';
import { api } from '../../services/api';
import AppHeader from '../../components/AppHeader.vue';

const chantiers = ref([]);
const newName = ref('');
const newAddress = ref('');

async function refresh() {
  const { data } = await api.get('/chantiers');
  chantiers.value = data;
}

onMounted(refresh);

async function create() {
  if (!newName.value.trim()) return;
  await api.post('/chantiers', { name: newName.value.trim(), address: newAddress.value.trim() });
  newName.value = '';
  newAddress.value = '';
  await refresh();
}

async function deactivate(c) {
  await api.delete(`/chantiers/${c.id}`);
  await refresh();
}
</script>

<template>
  <AppHeader title="Chantiers" />
  <div class="content">
    <form class="new" @submit.prevent="create">
      <input v-model="newName" placeholder="Nom du chantier" />
      <input v-model="newAddress" placeholder="Adresse (optionnel)" />
      <button type="submit">Ajouter</button>
    </form>

    <div v-for="c in chantiers" :key="c.id" class="row">
      <div>
        <strong>{{ c.name }}</strong>
        <span v-if="c.address">{{ c.address }}</span>
        <span v-if="!c.latitude || !c.longitude" class="warn">Sans coordonnées GPS (à corriger dans Odoo)</span>
      </div>
      <button class="danger" @click="deactivate(c)">Désactiver</button>
    </div>
  </div>
</template>

<style scoped>
.content {
  padding: 16px;
  display: flex;
  flex-direction: column;
  gap: 12px;
}

.new {
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.new input {
  padding: 10px;
  border: 1px solid var(--border);
  border-radius: 8px;
}

.new button {
  padding: 10px 14px;
  border: none;
  border-radius: 8px;
  background: var(--primary);
  color: white;
  font-weight: 600;
}

.warn {
  color: var(--warn-text);
}

.row {
  background: var(--surface);
  border: 1px solid var(--border);
  border-radius: 12px;
  padding: 12px 16px;
  display: flex;
  justify-content: space-between;
  align-items: center;
  gap: 8px;
}

.row div {
  display: flex;
  flex-direction: column;
}

.row span {
  font-size: 12px;
  color: var(--text-muted);
}

.danger {
  color: var(--danger);
  border: 1px solid var(--danger);
  border-radius: 6px;
  background: white;
  font-size: 12px;
  padding: 6px 8px;
}
</style>
