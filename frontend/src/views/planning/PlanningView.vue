<script setup>
import { computed, onMounted, ref, watch } from 'vue';
import { api } from '../../services/api';

const view = ref('jour'); // 'jour' | 'semaine'
const selectedDate = ref(toIso(new Date()));
const shifts = ref([]);
const weekShiftsByDay = ref({});
const loading = ref(false);

function toIso(date) {
  return date.toISOString().slice(0, 10);
}

function startOfWeek(dateIso) {
  const d = new Date(dateIso + 'T00:00:00');
  const day = (d.getDay() + 6) % 7; // 0 = lundi
  d.setDate(d.getDate() - day);
  return d;
}

const weekDays = computed(() => {
  const start = startOfWeek(selectedDate.value);
  return Array.from({ length: 6 }, (_, i) => {
    const d = new Date(start);
    d.setDate(start.getDate() + i);
    return d;
  });
});

const selectedDateLabel = computed(() =>
  new Date(selectedDate.value + 'T00:00:00').toLocaleDateString('fr-FR', {
    weekday: 'long',
    day: 'numeric',
    month: 'long',
  })
);

async function loadDay() {
  loading.value = true;
  try {
    const { data } = await api.get('/shifts/mine', {
      params: { from: selectedDate.value, to: selectedDate.value },
    });
    shifts.value = data;
  } finally {
    loading.value = false;
  }
}

async function loadWeek() {
  loading.value = true;
  try {
    const start = weekDays.value[0];
    const end = weekDays.value[weekDays.value.length - 1];
    const { data } = await api.get('/shifts/mine', {
      params: { from: toIso(start), to: toIso(end) },
    });
    const byDay = {};
    for (const s of data) {
      const day = s.start_at.slice(0, 10);
      (byDay[day] ||= []).push(s);
    }
    weekShiftsByDay.value = byDay;
  } finally {
    loading.value = false;
  }
}

function refresh() {
  if (view.value === 'jour') loadDay();
  else loadWeek();
}

function pickDay(date) {
  selectedDate.value = toIso(date);
  view.value = 'jour';
}

function timeRange(shift) {
  const fmt = (iso) =>
    new Date(iso).toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' });
  return `${fmt(shift.start_at)} - ${fmt(shift.end_at)}`;
}

watch(view, refresh);
onMounted(refresh);
</script>

<template>
  <div class="planning">
    <h1>Planning</h1>

    <div class="view-toggle">
      <button :class="{ active: view === 'jour' }" @click="view = 'jour'">Jour</button>
      <button :class="{ active: view === 'semaine' }" @click="view = 'semaine'">Semaine</button>
    </div>

    <div v-if="view === 'jour'">
      <div class="days">
        <button
          v-for="d in weekDays"
          :key="toIso(d)"
          class="day"
          :class="{ active: toIso(d) === selectedDate }"
          @click="pickDay(d)"
        >
          <span class="dname">{{ d.toLocaleDateString('fr-FR', { weekday: 'short' }) }}</span>
          <span class="dnum">{{ d.getDate() }}</span>
        </button>
      </div>

      <p class="section-title">{{ selectedDateLabel }}</p>

      <div class="shift" v-for="s in shifts" :key="s.id">
        <div class="bar" :class="s.status"></div>
        <div class="card">
          <div class="top">
            <span class="time">{{ timeRange(s) }}</span>
            <span class="badge" :class="s.status">{{ s.status }}</span>
          </div>
          <p class="client">{{ s.chantier_name }}</p>
          <p class="place">📍 {{ s.chantier_address || s.chantier_name }}</p>
          <p v-if="s.note" class="note">{{ s.note }}</p>
        </div>
      </div>
      <p v-if="!loading && !shifts.length" class="empty">Aucune vacation ce jour-là.</p>
    </div>

    <div v-else class="week">
      <div v-for="d in weekDays" :key="toIso(d)" class="week-day" @click="pickDay(d)">
        <div class="week-day-head">
          <strong>{{ d.toLocaleDateString('fr-FR', { weekday: 'long', day: 'numeric', month: 'short' }) }}</strong>
          <span class="count">{{ (weekShiftsByDay[toIso(d)] || []).length }}</span>
        </div>
        <div v-for="s in weekShiftsByDay[toIso(d)] || []" :key="s.id" class="week-shift">
          {{ timeRange(s) }} · {{ s.chantier_name }}
        </div>
      </div>
    </div>
  </div>
</template>

<style scoped>
.planning {
  padding: 16px;
}

h1 {
  font-size: 18px;
  margin: 0 0 12px;
}

.view-toggle {
  display: flex;
  background: var(--surface-1, #f1f5f9);
  border-radius: 10px;
  padding: 3px;
  margin-bottom: 14px;
}

.view-toggle button {
  flex: 1;
  border: none;
  background: transparent;
  padding: 8px 0;
  border-radius: 8px;
  font-size: 13px;
  color: var(--text-muted);
}

.view-toggle button.active {
  background: var(--surface);
  color: var(--text);
  font-weight: 600;
}

.days {
  display: flex;
  gap: 6px;
  overflow-x: auto;
  padding-bottom: 4px;
  margin-bottom: 10px;
}

.day {
  flex-shrink: 0;
  min-width: 42px;
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 4px;
  border: none;
  background: transparent;
  padding: 4px 0;
}

.day .dname {
  font-size: 10px;
  color: var(--text-muted);
}

.day .dnum {
  width: 30px;
  height: 30px;
  border-radius: 50%;
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 12px;
  color: var(--text);
}

.day.active .dnum {
  background: var(--primary);
  color: white;
  font-weight: 600;
}

.section-title {
  font-size: 13px;
  font-weight: 600;
  text-transform: capitalize;
  margin: 12px 0 8px;
}

.shift {
  display: flex;
  gap: 10px;
  margin-bottom: 10px;
}

.bar {
  width: 3px;
  border-radius: 2px;
  flex-shrink: 0;
  background: var(--border);
}

.bar.confirmed {
  background: var(--primary);
}

.card {
  flex: 1;
  background: var(--surface);
  border: 1px solid var(--border);
  border-radius: 12px;
  padding: 12px 14px;
}

.top {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 4px;
}

.time {
  font-size: 13px;
  font-weight: 600;
}

.badge {
  font-size: 11px;
  padding: 2px 9px;
  border-radius: 8px;
  background: var(--border);
  color: var(--text-muted);
}

.badge.confirmed {
  background: #eaf3de;
  color: #3b6d11;
}

.badge.modified {
  background: #faeeda;
  color: #854f0b;
}

.client {
  font-size: 14px;
  font-weight: 600;
  margin: 4px 0 2px;
}

.place,
.note {
  font-size: 12px;
  color: var(--text-muted);
  margin: 2px 0 0;
}

.empty {
  text-align: center;
  color: var(--text-muted);
  margin-top: 32px;
}

.week-day {
  background: var(--surface);
  border: 1px solid var(--border);
  border-radius: 12px;
  padding: 12px 14px;
  margin-bottom: 10px;
}

.week-day-head {
  display: flex;
  justify-content: space-between;
  align-items: center;
  font-size: 13px;
  text-transform: capitalize;
}

.count {
  font-size: 11px;
  color: var(--text-muted);
}

.week-shift {
  font-size: 12px;
  color: var(--text-muted);
  margin-top: 6px;
}
</style>
