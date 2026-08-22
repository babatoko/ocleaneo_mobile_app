<script setup>
import { computed, onMounted, ref } from 'vue';
import { api } from '../../services/api';
import { useChantiersStore } from '../../stores/chantiers';
import { isNfcSupported, scanNfcTag } from '../../services/nfc';

const chantiers = useChantiersStore();
const todayShifts = ref([]);
const entries = ref([]);
const status = ref('out'); // 'in' | 'out', pour le dernier pointage du jour tous chantiers confondus
const now = ref(new Date());

const nfcSupported = ref(null); // null = vérification en cours
const scanning = ref(false);
const scanError = ref('');

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
}

onMounted(async () => {
  nfcSupported.value = await isNfcSupported();
  await chantiers.fetchMine();
  await load();
  setInterval(() => (now.value = new Date()), 1000);
});

const lastEntry = computed(() => entries.value[entries.value.length - 1]);

const displayEntries = computed(() => {
  if (status.value !== 'in' || !lastEntry.value) return entries.value;
  const shift = todayShifts.value.find((s) => s.chantier_id === lastEntry.value.chantier_id);
  if (!shift) return entries.value;
  return [
    ...entries.value,
    { id: 'planned-departure', type: 'out', planned: true, plannedTime: shift.end_at },
  ];
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

async function scanAndClock() {
  if (scanning.value) return;
  scanError.value = '';
  scanning.value = true;
  try {
    const uid = await scanNfcTag();
    const chantier = chantiers.list.find(
      (c) => c.nfc_tag_id && c.nfc_tag_id.toLowerCase() === uid.toLowerCase()
    );
    if (!chantier) {
      scanError.value = 'Badge non reconnu. Contactez votre responsable.';
      return;
    }

    const position = await getPosition();
    const lastForChantier = [...entries.value].reverse().find((e) => e.chantier_id === chantier.id);
    const shift = todayShifts.value.find((s) => s.chantier_id === chantier.id);

    await api.post('/time-entries', {
      chantierId: chantier.id,
      shiftId: shift?.id,
      type: lastForChantier?.type === 'in' ? 'out' : 'in',
      ...position,
    });
    await load();
  } catch (e) {
    scanError.value = e.message || 'Lecture NFC impossible.';
  } finally {
    scanning.value = false;
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

  <div class="clock-wrap">
    <button
      class="nfc-circle"
      :class="{ active: status === 'in', scanning }"
      :disabled="scanning || !nfcSupported"
      @click="scanAndClock"
    >
      <i class="ti" :class="scanning ? 'ti-loader-2 spin' : 'ti-nfc'"></i>
      <p v-if="nfcSupported === false">NFC non disponible sur cet appareil</p>
      <p v-else-if="scanning">Lecture en cours…</p>
      <p v-else>Approchez le badge du chantier</p>
    </button>
    <p class="big-time">{{ now.toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' }) }}</p>
    <p v-if="scanError" class="scan-error"><i class="ti ti-alert-circle"></i> {{ scanError }}</p>
    <p v-else-if="lastEntry" class="status-line">
      {{ status === 'in' ? 'Présent' : 'Absent' }} — {{ lastEntry.chantier_name }}
    </p>
  </div>

  <div class="history">
    <p class="history-title">Historique du jour</p>
    <div v-for="e in displayEntries" :key="e.id" class="hist-row">
      <div class="hist-icon" :class="e.type">
        <i class="ti" :class="e.type === 'in' ? 'ti-login-2' : 'ti-logout-2'"></i>
      </div>
      <div class="hist-text">
        <p class="lbl" :class="{ muted: e.planned }">{{ e.type === 'in' ? 'Arrivée' : 'Départ' }}</p>
        <p class="sub">{{ e.planned ? `Prévu ${fmtTime(e.plannedTime)}` : e.chantier_name }}</p>
      </div>
      <span class="hist-time" :class="{ muted: e.planned }">{{ e.planned ? '--:--' : fmtTime(e.recorded_at) }}</span>
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

.nfc-circle {
  cursor: pointer;
}

.nfc-circle:disabled {
  opacity: 0.6;
  cursor: default;
}

.spin {
  animation: spin 1s linear infinite;
}

@media (prefers-reduced-motion: reduce) {
  .spin {
    animation: none;
  }
}

@keyframes spin {
  to {
    transform: rotate(360deg);
  }
}

.scan-error {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 6px;
  font-size: 12px;
  color: var(--danger);
  margin: 4px 0 0;
}

.empty {
  text-align: center;
  color: var(--text-muted);
  margin-top: 24px;
}
</style>
