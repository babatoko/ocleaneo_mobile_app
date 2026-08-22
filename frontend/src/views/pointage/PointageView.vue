<script setup>
import { computed, onMounted, ref } from 'vue';
import { api } from '../../services/api';
import { useChantiersStore } from '../../stores/chantiers';

const chantiers = useChantiersStore();
const todayShifts = ref([]);
const entries = ref([]);
const status = ref('out'); // 'in' | 'out'
const selectedChantierId = ref(null);
const submitting = ref(false);
const now = ref(new Date());

function todayIso() {
  return new Date().toISOString().slice(0, 10);
}

async function load() {
  const [{ data: shiftsData }, { data: entriesData }] = await Promise.all([
    api.get('/shifts/mine', { params: { from: todayIso(), to: todayIso() } }),
    api.get('/time-entries/today'),
  ]);
  todayShifts.value = shiftsData;
  entries.value = entriesData.entries;
  status.value = entriesData.status;

  if (!selectedChantierId.value) {
    selectedChantierId.value = shiftsData[0]?.chantier_id ?? chantiers.list[0]?.id ?? null;
  }
}

onMounted(async () => {
  await chantiers.fetchMine();
  await load();
  setInterval(() => (now.value = new Date()), 1000);
});

const currentChantierName = computed(() => {
  const shift = todayShifts.value.find((s) => s.chantier_id === selectedChantierId.value);
  if (shift) return shift.chantier_name;
  return chantiers.list.find((c) => c.id === selectedChantierId.value)?.name || '';
});

function getPosition() {
  return new Promise((resolve) => {
    if (!navigator.geolocation) return resolve(null);
    navigator.geolocation.getCurrentPosition(
      (pos) => resolve({ latitude: pos.coords.latitude, longitude: pos.coords.longitude }),
      () => resolve(null),
      { timeout: 3000 }
    );
  });
}

async function clock() {
  if (!selectedChantierId.value) return;
  submitting.value = true;
  try {
    const position = await getPosition();
    const shift = todayShifts.value.find((s) => s.chantier_id === selectedChantierId.value);
    await api.post('/time-entries', {
      chantierId: selectedChantierId.value,
      shiftId: shift?.id,
      type: status.value === 'in' ? 'out' : 'in',
      ...position,
    });
    await load();
  } finally {
    submitting.value = false;
  }
}

function fmtTime(iso) {
  return new Date(iso).toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' });
}
</script>

<template>
  <div class="pointage">
    <h1>Pointage</h1>
    <p class="date">{{ now.toLocaleDateString('fr-FR', { weekday: 'long', day: 'numeric', month: 'long' }) }}</p>

    <select v-if="chantiers.list.length > 1" v-model="selectedChantierId" class="chantier-select">
      <option v-for="c in chantiers.list" :key="c.id" :value="c.id">{{ c.name }}</option>
    </select>

    <div class="clock-wrap">
      <button class="clock-circle" :class="status" :disabled="submitting || !selectedChantierId" @click="clock">
        <span class="icon">{{ status === 'in' ? '⏸' : '▶' }}</span>
        <span class="hint">{{ status === 'in' ? 'Pointer le départ' : "Pointer l'arrivée" }}</span>
      </button>
      <p class="big-time">{{ now.toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' }) }}</p>
      <p class="status-line" v-if="currentChantierName">
        {{ status === 'in' ? 'Présent' : 'Absent' }} — {{ currentChantierName }}
      </p>
    </div>

    <div class="history">
      <p class="history-title">Historique du jour</p>
      <div v-for="e in entries" :key="e.id" class="hist-row">
        <div class="hist-icon" :class="e.type">{{ e.type === 'in' ? '→' : '←' }}</div>
        <div class="hist-text">
          <p class="lbl">{{ e.type === 'in' ? 'Arrivée' : 'Départ' }}</p>
          <p class="sub">{{ e.chantier_name }}</p>
        </div>
        <span class="hist-time">{{ fmtTime(e.recorded_at) }}</span>
      </div>
      <p v-if="!entries.length" class="empty">Aucun pointage aujourd'hui.</p>
    </div>
  </div>
</template>

<style scoped>
.pointage {
  padding: 16px;
}

h1 {
  font-size: 18px;
  margin: 0;
}

.date {
  font-size: 13px;
  color: var(--text-muted);
  text-transform: capitalize;
  margin: 2px 0 14px;
}

.chantier-select {
  width: 100%;
  padding: 10px;
  border: 1px solid var(--border);
  border-radius: 8px;
  margin-bottom: 12px;
}

.clock-wrap {
  display: flex;
  flex-direction: column;
  align-items: center;
  padding: 8px 0 16px;
}

.clock-circle {
  width: 150px;
  height: 150px;
  border-radius: 50%;
  border: 2px solid var(--primary);
  background: var(--surface);
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 8px;
}

.clock-circle.in {
  border-color: var(--danger);
}

.clock-circle .icon {
  font-size: 28px;
  color: var(--primary);
}

.clock-circle.in .icon {
  color: var(--danger);
}

.clock-circle .hint {
  font-size: 12px;
  color: var(--text-muted);
  padding: 0 20px;
  text-align: center;
}

.big-time {
  font-size: 22px;
  font-weight: 600;
  margin: 14px 0 0;
}

.status-line {
  font-size: 12px;
  color: var(--primary);
  margin: 4px 0 0;
}

.history {
  margin-top: 12px;
}

.history-title {
  font-size: 12px;
  color: var(--text-muted);
  margin: 0 0 8px;
}

.hist-row {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 9px 0;
  border-bottom: 1px solid var(--border);
}

.hist-icon {
  width: 30px;
  height: 30px;
  border-radius: 50%;
  display: flex;
  align-items: center;
  justify-content: center;
  flex-shrink: 0;
  background: var(--surface-1, #f1f5f9);
}

.hist-icon.in {
  background: #eaf3de;
  color: #3b6d11;
}

.hist-text {
  flex: 1;
}

.hist-text .lbl {
  font-size: 13px;
  margin: 0;
}

.hist-text .sub {
  font-size: 11px;
  color: var(--text-muted);
  margin: 1px 0 0;
}

.hist-time {
  font-size: 13px;
  font-weight: 600;
}

.empty {
  text-align: center;
  color: var(--text-muted);
  margin-top: 24px;
}
</style>
