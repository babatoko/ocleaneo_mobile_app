<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref, watch } from 'vue';
import { useRouter } from 'vue-router';
import { Capacitor } from '@capacitor/core';
import { IonContent, IonIcon, IonPage, IonSpinner } from '@ionic/vue';
import {
  alarmOutline,
  alertCircleOutline,
  checkmarkOutline,
  chevronForwardOutline,
  cloudOfflineOutline,
  cloudUploadOutline,
  logInOutline,
  logOutOutline,
  pauseOutline,
  playOutline,
  radioOutline,
  stopOutline,
  warningOutline,
} from 'ionicons/icons';
import { usePointageStore } from '../../stores/pointage';
import { useChantiersStore } from '../../stores/chantiers';
import { isNfcSupported, startIosNfcSession, cancelIosNfcSession } from '../../services/nfc';
import type { TimeEntry, TimeEntryType } from '../../types/models';

interface PlannedDepartureEntry {
  id: 'planned-departure';
  type: 'out';
  planned: true;
  plannedTime: Date | null;
  chantier_name?: undefined;
  recorded_at?: undefined;
  pending?: undefined;
}
type DisplayEntry = (TimeEntry & { planned?: false; plannedTime?: undefined }) | PlannedDepartureEntry;

const router = useRouter();
const pointage = usePointageStore();
const chantiers = useChantiersStore();
const now = ref(new Date());
const nfcSupported = ref<boolean | null>(null); // null = vérification en cours
const isIos = Capacitor.getPlatform() === 'ios';
const justSucceeded = ref(false);

let clockInterval: ReturnType<typeof setInterval> | undefined;
let scanTimeout: ReturnType<typeof setTimeout> | undefined;
let messageTimeout: ReturnType<typeof setTimeout> | undefined;
let initialLoadDone = false;

onMounted(async () => {
  nfcSupported.value = await isNfcSupported();
  pointage.initGlobalListener(router);
  await chantiers.fetchMine();
  await pointage.loadSafe();
  await pointage.loadWeekSummary().catch(() => {});
  await pointage.refreshQueueCount();
  initialLoadDone = true;
  clockInterval = setInterval(() => {
    now.value = new Date();
    pointage.updateTick(); // fait avancer le total d'heures de la semaine
  }, 1000);
});

onUnmounted(() => {
  clearInterval(clockInterval);
  clearTimeout(scanTimeout);
  clearTimeout(messageTimeout);
});

watch(
  () => pointage.entries.length,
  (len, prevLen) => {
    // Ignore le peuplement initial (chargement des pointages déjà existants) :
    // seule une lecture de badge en direct doit déclencher l'animation.
    if (initialLoadDone && len > prevLen && !pointage.scanError) {
      justSucceeded.value = true;
      setTimeout(() => (justSucceeded.value = false), 1400);
    }
  }
);

watch(
  () => pointage.lastMessage,
  (msg) => {
    clearTimeout(messageTimeout);
    if (msg) messageTimeout = setTimeout(() => (pointage.lastMessage = null), 6000);
  }
);

const displayEntries = computed((): DisplayEntry[] => {
  const lastEntry = pointage.lastEntry as TimeEntry | undefined;
  if (pointage.status !== 'in' || !lastEntry) return pointage.entries;
  const shift = pointage.todayShifts.find((s) => s.chantier_id === lastEntry.chantier_id);
  if (!shift) return pointage.entries;
  return [
    ...pointage.entries,
    { id: 'planned-departure', type: 'out', planned: true, plannedTime: (pointage.estimatedDepartureFor as (s: typeof shift) => Date | null)(shift) },
  ];
});

// Vacation dépassée depuis longtemps sans départ badgé : renforce le rappel
// programmé (qui peut être manqué ou retardé par le système).
const overdueMinutes = computed(() => {
  const lastEntry = pointage.lastEntry as TimeEntry | undefined;
  if (pointage.status !== 'in' || !lastEntry) return 0;
  const shift = pointage.todayShifts.find((s) => s.chantier_id === lastEntry.chantier_id);
  if (!shift) return 0;
  const estimated = (pointage.estimatedDepartureFor as (s: typeof shift) => Date | null)(shift);
  if (!estimated) return 0;
  const diffMin = (now.value.getTime() - estimated.getTime()) / 60000;
  return diffMin > 20 ? Math.round(diffMin) : 0;
});

// Un médaillon coloré seul était ambigu (vert = absent, ambre = présent se
// lisait comme un avertissement) : le statut est désormais écrit.
const statusText = computed(() =>
  pointage.status === 'in' ? 'Présent' : pointage.status === 'paused' ? 'En pause' : 'Absent'
);

const statusIcon = computed(() =>
  pointage.status === 'in' ? playOutline : pointage.status === 'paused' ? pauseOutline : stopOutline
);

function fmtOverdue(min: number): string {
  if (min < 60) return `${min} min`;
  return `${Math.floor(min / 60)}h${String(min % 60).padStart(2, '0')}`;
}

const weekHoursLabel = computed(() => {
  const worked = pointage.weekWorkedHours as number;
  const planned = pointage.weekPlannedHours as number;
  const fmt = (h: number) => `${Math.floor(h)}h${String(Math.round((h % 1) * 60)).padStart(2, '0')}`;
  return `${fmt(worked)} / ${fmt(planned)} prévues`;
});

const weekProgressPct = computed(() => {
  if (!pointage.weekPlannedHours) return 0;
  return Math.min(100, Math.round((pointage.weekWorkedHours / pointage.weekPlannedHours) * 100));
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
    pointage.scanError = (e instanceof Error && e.message) || 'Lecture NFC impossible.';
  }
}

function entryIcon(type: TimeEntryType): string {
  if (type === 'in') return logInOutline;
  if (type === 'pause_start') return pauseOutline;
  if (type === 'pause_end') return playOutline;
  return logOutOutline;
}

function entryLabel(type: TimeEntryType): string {
  if (type === 'in') return 'Arrivée';
  if (type === 'pause_start') return 'Pause';
  if (type === 'pause_end') return 'Reprise';
  return 'Départ';
}

function fmtTime(iso: string | Date | null | undefined): string {
  if (!iso) return '--:--';
  return new Date(iso).toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' });
}
</script>

<template>
  <ion-page>
    <ion-content>
  <div class="header">
    <div>
      <p class="hello">Pointage</p>
      <p class="name sub-name">{{ now.toLocaleDateString('fr-FR', { weekday: 'long', day: 'numeric', month: 'long' }) }}</p>
    </div>
    <div class="status-pill" :class="pointage.status">
      <ion-icon :icon="statusIcon"></ion-icon>
      <span>{{ statusText }}</span>
    </div>
  </div>

  <div v-if="pointage.offlineQueueCount > 0" class="offline-banner">
    <ion-icon :icon="cloudOfflineOutline"></ion-icon>
    <span>{{ pointage.offlineQueueCount }} pointage{{ pointage.offlineQueueCount > 1 ? 's' : '' }} en attente de synchronisation</span>
  </div>

  <div v-if="pointage.lastMessage" class="soft-banner" :class="pointage.lastMessage.type">
    <ion-icon :icon="pointage.lastMessage.type === 'warn' ? warningOutline : cloudUploadOutline"></ion-icon>
    <span>{{ pointage.lastMessage.text }}</span>
  </div>

  <div v-if="overdueMinutes" class="soft-banner warn">
    <ion-icon :icon="alarmOutline"></ion-icon>
    <span>Vacation dépassée de {{ fmtOverdue(overdueMinutes) }} — n'oubliez pas de badger votre départ.</span>
  </div>

  <div class="clock-wrap">
    <button
      class="nfc-circle"
      :class="{ active: pointage.status !== 'out', scanning: pointage.scanning, success: justSucceeded }"
      :disabled="pointage.scanning || !nfcSupported"
      @click="onCircleClick"
    >
      <ion-icon v-if="justSucceeded" :icon="checkmarkOutline" class="checkmark"></ion-icon>
      <ion-spinner v-else-if="pointage.scanning" name="crescent"></ion-spinner>
      <ion-icon v-else :icon="radioOutline"></ion-icon>
      <p v-if="nfcSupported === false">NFC non disponible sur cet appareil</p>
      <p v-else-if="pointage.scanning">Lecture en cours…</p>
      <p v-else>Approchez le badge du chantier</p>
    </button>
    <p class="big-time">{{ now.toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' }) }}</p>
    <p v-if="pointage.scanError" class="scan-error"><ion-icon :icon="alertCircleOutline"></ion-icon> {{ pointage.scanError }}</p>
    <p v-else-if="pointage.lastEntry" class="status-line">
      {{ statusText }} — {{ pointage.lastEntry.chantier_name }}
    </p>

    <div v-if="pointage.status === 'in'" class="pause-actions">
      <button type="button" class="pause-btn" @click="pointage.startPause()">
        <ion-icon :icon="pauseOutline"></ion-icon> Pause
      </button>
    </div>
    <div v-else-if="pointage.status === 'paused'" class="pause-actions">
      <button type="button" class="pause-btn resume" @click="pointage.endPause()">
        <ion-icon :icon="playOutline"></ion-icon> Reprendre
      </button>
    </div>
  </div>

  <div class="week-summary">
    <div class="ws-top">
      <span class="ws-lbl">Heures cette semaine</span>
      <span v-if="pointage.weekOvertimeHours > 0" class="ws-overtime">Dépassement</span>
    </div>
    <p class="ws-value">{{ weekHoursLabel }}</p>
    <div class="hours-bar"><div class="hours-bar-fill" :class="{ over: pointage.weekOvertimeHours > 0 }" :style="{ width: weekProgressPct + '%' }"></div></div>
  </div>

  <div class="history">
    <div class="history-head">
      <p class="history-title">Historique du jour</p>
      <RouterLink to="/pointage/historique" class="see-all">Tout voir <ion-icon :icon="chevronForwardOutline"></ion-icon></RouterLink>
    </div>
    <div v-for="e in displayEntries" :key="e.id" class="hist-row">
      <div class="hist-icon" :class="e.type">
        <ion-icon :icon="entryIcon(e.type)"></ion-icon>
      </div>
      <div class="hist-text">
        <p class="lbl" :class="{ muted: e.planned }">{{ entryLabel(e.type) }}</p>
        <p class="sub">
          {{ e.planned ? `Prévu ${fmtTime(e.plannedTime)}` : e.pending ? 'En attente de synchronisation' : e.chantier_name }}
        </p>
      </div>
      <span class="hist-time" :class="{ muted: e.planned || e.pending }">{{ e.planned ? '--:--' : fmtTime(e.recorded_at) }}</span>
    </div>
    <p v-if="!pointage.entries.length" class="empty">Aucun pointage aujourd'hui.</p>
  </div>
    </ion-content>
  </ion-page>
</template>

<style scoped>
.sub-name {
  font-size: 13px;
  color: var(--text-secondary);
  font-weight: 400;
  text-transform: capitalize;
}

.status-pill {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 5px 11px;
  border-radius: 20px;
  font-size: 12px;
  font-weight: 500;
  flex-shrink: 0;
  background: var(--surface-1);
  color: var(--text-secondary);
}

.status-pill ion-icon {
  font-size: 14px;
}

.status-pill.in {
  background: var(--success-bg);
  color: var(--success-text);
}

.status-pill.paused {
  background: var(--warn-bg);
  color: var(--warn-text);
}

.offline-banner,
.soft-banner {
  display: flex;
  align-items: center;
  gap: 8px;
  margin: 0 18px 10px;
  padding: 9px 12px;
  border-radius: 10px;
  font-size: 12px;
  background: var(--surface-1);
  color: var(--text-secondary);
}

.offline-banner ion-icon,
.soft-banner ion-icon {
  font-size: 15px;
  flex-shrink: 0;
}

.soft-banner.warn {
  background: var(--warn-bg);
  color: var(--warn-text);
}

.soft-banner.queued {
  background: var(--accent-bg);
  color: var(--accent-text);
}

.nfc-circle {
  cursor: pointer;
  position: relative;
}

.nfc-circle:disabled {
  opacity: 0.6;
  cursor: default;
}

.nfc-circle.success {
  border-color: var(--accent);
}

.checkmark {
  color: var(--accent);
  font-size: 32px;
  animation: pop-in 0.35s cubic-bezier(0.34, 1.56, 0.64, 1);
}

@keyframes pop-in {
  from {
    transform: scale(0.4);
    opacity: 0;
  }
  to {
    transform: scale(1);
    opacity: 1;
  }
}

@media (prefers-reduced-motion: reduce) {
  .checkmark {
    animation: none;
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

.pause-actions {
  margin-top: 14px;
}

.pause-btn {
  display: flex;
  align-items: center;
  gap: 6px;
  font-size: 13px;
  font-weight: 500;
  color: var(--text-primary);
  background: var(--surface-1);
  border: none;
  border-radius: 10px;
  padding: 9px 16px;
}

.pause-btn.resume {
  background: var(--accent-bg);
  color: var(--accent-text);
}

.week-summary {
  margin: 4px 18px 14px;
  background: var(--surface-1);
  border-radius: 12px;
  padding: 12px 14px;
}

.ws-top {
  display: flex;
  align-items: center;
  justify-content: space-between;
}

.ws-lbl {
  font-size: 12px;
  color: var(--text-secondary);
}

.ws-overtime {
  font-size: 10.5px;
  font-weight: 600;
  color: var(--warn-text);
  background: var(--warn-bg);
  padding: 2px 8px;
  border-radius: 7px;
}

.ws-value {
  font-size: 15px;
  font-weight: 500;
  margin: 4px 0 8px;
}

.hours-bar {
  height: 6px;
  border-radius: 4px;
  background: var(--surface-2);
  overflow: hidden;
}

.hours-bar-fill {
  height: 100%;
  border-radius: 4px;
  background: var(--accent);
}

.hours-bar-fill.over {
  background: var(--warn-text);
}

.history-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 0 18px;
}

.history-head .history-title {
  padding: 0;
}

.history-head .see-all {
  font-size: 12px;
  color: var(--accent-text);
  display: flex;
  align-items: center;
  gap: 2px;
  text-decoration: none;
}

.empty {
  text-align: center;
  color: var(--text-muted);
  margin-top: 24px;
}
</style>
