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
  <div class="header">
    <div>
      <p class="hello">Pointage</p>
      <p class="name sub-name">{{ now.toLocaleDateString('fr-FR', { weekday: 'long', day: 'numeric', month: 'long' }) }}</p>
    </div>
    <div class="avatar status-avatar" :class="{ active: status === 'in' }">
      <i class="ti ti-shield-check"></i>
    </div>
  </div>

  <div class="chantier-select-wrap" v-if="chantiers.list.length > 1">
    <select v-model="selectedChantierId" class="chantier-select">
      <option v-for="c in chantiers.list" :key="c.id" :value="c.id">{{ c.name }}</option>
    </select>
  </div>

  <div class="clock-wrap">
    <button class="nfc-circle" :class="{ active: status === 'in' }" :disabled="submitting || !selectedChantierId" @click="clock">
      <i class="ti" :class="status === 'in' ? 'ti-player-pause' : 'ti-player-play'"></i>
      <p>{{ status === 'in' ? 'Pointer le départ' : "Pointer l'arrivée" }}</p>
    </button>
    <p class="big-time">{{ now.toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' }) }}</p>
    <p class="status-line" v-if="currentChantierName">
      {{ status === 'in' ? 'Présent' : 'Absent' }} — {{ currentChantierName }}
    </p>
  </div>

  <div class="history">
    <p class="history-title">Historique du jour</p>
    <div v-for="e in entries" :key="e.id" class="hist-row">
      <div class="hist-icon" :class="e.type">
        <i class="ti" :class="e.type === 'in' ? 'ti-login-2' : 'ti-logout-2'"></i>
      </div>
      <div class="hist-text">
        <p class="lbl">{{ e.type === 'in' ? 'Arrivée' : 'Départ' }}</p>
        <p class="sub">{{ e.chantier_name }}</p>
      </div>
      <span class="hist-time">{{ fmtTime(e.recorded_at) }}</span>
    </div>
    <p v-if="!entries.length" class="empty">Aucun pointage aujourd'hui.</p>
  </div>
</template>

<style scoped>
.sub-name {
  font-size: 13px;
  color: var(--text-secondary);
  font-weight: 400;
  text-transform: capitalize;
}

.status-avatar {
  background: var(--success-bg);
  color: var(--success-text);
}

.status-avatar.active {
  background: var(--warn-bg);
  color: var(--warn-text);
}

.status-avatar i {
  font-size: 16px;
}

.chantier-select-wrap {
  padding: 0 18px 10px;
}

.chantier-select {
  width: 100%;
  padding: 10px 12px;
  border: 1px solid var(--border);
  border-radius: 10px;
  background: var(--surface-1);
}

.nfc-circle {
  cursor: pointer;
}

.empty {
  text-align: center;
  color: var(--text-muted);
  margin-top: 24px;
}
</style>
