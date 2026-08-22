<script setup>
import { computed, onMounted, onUnmounted, ref } from 'vue';
import { useRouter } from 'vue-router';
import { Capacitor } from '@capacitor/core';
import { usePointageStore } from '../../stores/pointage';
import { useChantiersStore } from '../../stores/chantiers';
import { isNfcSupported, startIosNfcSession, cancelIosNfcSession } from '../../services/nfc';

const router = useRouter();
const pointage = usePointageStore();
const chantiers = useChantiersStore();
const now = ref(new Date());
const nfcSupported = ref(null); // null = vérification en cours
const isIos = Capacitor.getPlatform() === 'ios';

let clockInterval;
let scanTimeout;

onMounted(async () => {
  nfcSupported.value = await isNfcSupported();
  pointage.initGlobalListener(router);
  await chantiers.fetchMine();
  await pointage.load();
  clockInterval = setInterval(() => (now.value = new Date()), 1000);
});

onUnmounted(() => {
  clearInterval(clockInterval);
  clearTimeout(scanTimeout);
});

const displayEntries = computed(() => {
  if (pointage.status !== 'in' || !pointage.lastEntry) return pointage.entries;
  const shift = pointage.todayShifts.find((s) => s.chantier_id === pointage.lastEntry.chantier_id);
  if (!shift) return pointage.entries;
  return [
    ...pointage.entries,
    { id: 'planned-departure', type: 'out', planned: true, plannedTime: shift.end_at },
  ];
});

async function onCircleClick() {
  // Android : la lecture est déclenchée automatiquement au tap du badge, ce
  // bouton n'a rien à démarrer. iOS : il faut ouvrir la session explicitement.
  if (!isIos || pointage.scanning) return;
  pointage.scanError = '';
  pointage.scanning = true;
  clearTimeout(scanTimeout);
  scanTimeout = setTimeout(() => {
    if (pointage.scanning) {
      pointage.scanning = false;
      pointage.scanError = 'Aucun badge détecté.';
      cancelIosNfcSession();
    }
  }, 30000);
  try {
    await startIosNfcSession();
  } catch (e) {
    pointage.scanning = false;
    pointage.scanError = e.message || 'Lecture NFC impossible.';
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
    <div class="avatar status-avatar" :class="{ active: pointage.status === 'in' }">
      <i class="ti ti-shield-check"></i>
    </div>
  </div>

  <div class="clock-wrap">
    <button
      class="nfc-circle"
      :class="{ active: pointage.status === 'in', scanning: pointage.scanning }"
      :disabled="pointage.scanning || !nfcSupported"
      @click="onCircleClick"
    >
      <i class="ti" :class="pointage.scanning ? 'ti-loader-2 spin' : 'ti-nfc'"></i>
      <p v-if="nfcSupported === false">NFC non disponible sur cet appareil</p>
      <p v-else-if="pointage.scanning">Lecture en cours…</p>
      <p v-else>Approchez le badge du chantier</p>
    </button>
    <p class="big-time">{{ now.toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' }) }}</p>
    <p v-if="pointage.scanError" class="scan-error"><i class="ti ti-alert-circle"></i> {{ pointage.scanError }}</p>
    <p v-else-if="pointage.lastEntry" class="status-line">
      {{ pointage.status === 'in' ? 'Présent' : 'Absent' }} — {{ pointage.lastEntry.chantier_name }}
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
    <p v-if="!pointage.entries.length" class="empty">Aucun pointage aujourd'hui.</p>
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
