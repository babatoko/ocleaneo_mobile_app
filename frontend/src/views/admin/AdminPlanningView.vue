<script setup>
import { onMounted, ref } from 'vue';
import { api } from '../../services/api';
import AppHeader from '../../components/AppHeader.vue';

const employees = ref([]);
const chantiers = ref([]);
const shifts = ref([]);
const selectedDate = ref(new Date().toISOString().slice(0, 10));

const form = ref({ employeeId: '', chantierId: '', date: selectedDate.value, start: '08:00', end: '11:00', note: '' });

async function refresh() {
  const [{ data: emp }, { data: ch }, { data: sh }] = await Promise.all([
    api.get('/employees'),
    api.get('/chantiers'),
    api.get('/shifts', { params: { from: selectedDate.value, to: selectedDate.value } }),
  ]);
  employees.value = emp;
  chantiers.value = ch;
  shifts.value = sh;
}

onMounted(refresh);

async function createShift() {
  if (!form.value.employeeId || !form.value.chantierId) return;
  await api.post('/shifts', {
    employeeId: Number(form.value.employeeId),
    chantierId: Number(form.value.chantierId),
    startAt: `${form.value.date}T${form.value.start}:00`,
    endAt: `${form.value.date}T${form.value.end}:00`,
    note: form.value.note || null,
  });
  form.value.note = '';
  selectedDate.value = form.value.date;
  await refresh();
}

async function cancelShift(s) {
  await api.delete(`/shifts/${s.id}`);
  await refresh();
}

function timeRange(s) {
  const fmt = (iso) => new Date(iso).toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' });
  return `${fmt(s.start_at)} - ${fmt(s.end_at)}`;
}
</script>

<template>
  <AppHeader title="Planning" />
  <div class="content">
    <form class="new" @submit.prevent="createShift">
      <select v-model="form.employeeId" required>
        <option value="" disabled>Salarié</option>
        <option v-for="e in employees" :key="e.id" :value="e.id">{{ e.name }}</option>
      </select>
      <select v-model="form.chantierId" required>
        <option value="" disabled>Chantier</option>
        <option v-for="c in chantiers" :key="c.id" :value="c.id">{{ c.name }}</option>
      </select>
      <div class="row">
        <input v-model="form.date" type="date" required />
        <input v-model="form.start" type="time" required />
        <input v-model="form.end" type="time" required />
      </div>
      <input v-model="form.note" placeholder="Note (optionnel)" />
      <button type="submit">Ajouter la vacation</button>
    </form>

    <div class="date-picker">
      <label>Voir le</label>
      <input v-model="selectedDate" type="date" @change="refresh" />
    </div>

    <div v-for="s in shifts" :key="s.id" class="row-card">
      <div>
        <strong>{{ s.employee_name }} — {{ s.chantier_name }}</strong>
        <span>{{ timeRange(s) }}{{ s.note ? ' · ' + s.note : '' }}</span>
      </div>
      <button class="danger" @click="cancelShift(s)">Annuler</button>
    </div>
    <p v-if="!shifts.length" class="empty">Aucune vacation ce jour-là.</p>
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

.new select,
.new input {
  padding: 10px;
  border: 1px solid var(--border);
  border-radius: 8px;
}

.row {
  display: flex;
  gap: 8px;
}

.row input {
  flex: 1;
}

.new button {
  padding: 10px 14px;
  border: none;
  border-radius: 8px;
  background: var(--primary);
  color: white;
  font-weight: 600;
}

.date-picker {
  display: flex;
  align-items: center;
  gap: 8px;
  font-size: 13px;
  color: var(--text-muted);
}

.date-picker input {
  padding: 6px;
  border: 1px solid var(--border);
  border-radius: 6px;
}

.row-card {
  background: var(--surface);
  border: 1px solid var(--border);
  border-radius: 12px;
  padding: 12px 16px;
  display: flex;
  justify-content: space-between;
  align-items: center;
  gap: 8px;
}

.row-card div {
  display: flex;
  flex-direction: column;
}

.row-card span {
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

.empty {
  text-align: center;
  color: var(--text-muted);
}
</style>
