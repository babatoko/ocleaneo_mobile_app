<script setup>
import { computed, onMounted, ref, watch } from 'vue';
import { api } from '../../services/api';
import { useAuthStore } from '../../stores/auth';

const auth = useAuthStore();
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

const initials = computed(() =>
  (auth.employee?.name || '')
    .split(' ')
    .map((p) => p[0])
    .slice(0, 2)
    .join('')
    .toUpperCase()
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

function mapLink(address) {
  return `https://maps.google.com/?q=${encodeURIComponent(address)}`;
}

watch(view, refresh);
onMounted(() => {
  if (!auth.employee) auth.fetchMe();
  refresh();
});
</script>

<template>
  <div class="header">
    <div>
      <p class="hello">Bonjour</p>
      <p class="name">{{ auth.employee?.name || '' }}</p>
    </div>
    <div class="avatar">{{ initials }}</div>
  </div>

  <div class="view-toggle">
    <button class="opt" :class="{ active: view === 'jour' }" @click="view = 'jour'">Jour</button>
    <button class="opt" :class="{ active: view === 'semaine' }" @click="view = 'semaine'">Semaine</button>
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
          <span class="badge" :class="s.status">{{
            s.status === 'confirmed' ? 'confirmé' : s.status === 'modified' ? 'modifié' : s.status
          }}</span>
        </div>
        <p class="client">{{ s.chantier_name }}</p>
        <p class="place"><i class="ti ti-map-pin"></i> {{ s.chantier_address || s.chantier_name }}</p>
        <p v-if="s.note" class="meta">{{ s.note }}</p>
        <div class="card-actions">
          <a :href="mapLink(s.chantier_address || s.chantier_name)" target="_blank" rel="noopener">
            <i class="ti ti-map-2"></i> Itinéraire
          </a>
        </div>
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
</template>

<style scoped>
.week {
  padding: 0 18px 18px;
}

.week-day {
  background: var(--surface-1);
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
  color: var(--text-secondary);
  margin-top: 6px;
}

.empty {
  text-align: center;
  color: var(--text-muted);
  margin-top: 32px;
}
</style>
