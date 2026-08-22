<script setup>
import { onMounted, ref } from 'vue';
import { api } from '../../services/api';
import AppHeader from '../../components/AppHeader.vue';

const employees = ref([]);
const newName = ref('');

async function refresh() {
  const { data } = await api.get('/employees');
  employees.value = data;
}

onMounted(refresh);

async function create() {
  if (!newName.value.trim()) return;
  await api.post('/employees', { name: newName.value.trim() });
  newName.value = '';
  await refresh();
}

async function toggleAdmin(emp) {
  await api.patch(`/employees/${emp.id}/admin`, { isAdmin: !emp.is_admin });
  await refresh();
}

async function deactivate(emp) {
  await api.delete(`/employees/${emp.id}`);
  await refresh();
}
</script>

<template>
  <AppHeader title="Salariés" />
  <div class="content">
    <form class="new" @submit.prevent="create">
      <input v-model="newName" placeholder="Nom du salarié" />
      <button type="submit">Ajouter</button>
    </form>

    <div v-for="e in employees" :key="e.id" class="row">
      <div>
        <strong>{{ e.name }}</strong>
        <span>Code : {{ e.login_code }}{{ e.is_admin ? ' · admin' : '' }}</span>
      </div>
      <div class="actions">
        <button @click="toggleAdmin(e)">{{ e.is_admin ? 'Retirer admin' : 'Rendre admin' }}</button>
        <button class="danger" @click="deactivate(e)">Désactiver</button>
      </div>
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
  gap: 8px;
}

.new input {
  flex: 1;
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

.row div:first-child {
  display: flex;
  flex-direction: column;
}

.row span {
  font-size: 12px;
  color: var(--text-muted);
}

.actions {
  display: flex;
  gap: 6px;
}

.actions button {
  font-size: 12px;
  padding: 6px 8px;
  border: 1px solid var(--border);
  border-radius: 6px;
  background: white;
}

.actions .danger {
  color: var(--danger);
  border-color: var(--danger);
}
</style>
