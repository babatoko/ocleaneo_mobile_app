<script setup lang="ts">
import { computed, onMounted, ref } from 'vue';
import { IonBadge, IonContent, IonIcon, IonPage, IonRefresher, IonRefresherContent } from '@ionic/vue';
import { arrowBackOutline, arrowForwardOutline, pauseOutline, playOutline, timeOutline } from 'ionicons/icons';
import { provider } from '../../providers';
import { ProviderNetworkError } from '../../providers/DataProvider';
import { todayIso, addDaysIso } from '../../utils/date';
import { groupIntoShifts, fmtDuration, fmtPause } from '../../utils/shifts';
import AppHeader from '../../components/AppHeader.vue';
import DataState from '../../components/DataState.vue';
import type { TimeEntry, TimeEntryType } from '../../types/models';

const DAYS_BACK = 13; // 14 jours affichés, aujourd'hui inclus
const loading = ref(true);
const error = ref('');
const entries = ref<TimeEntry[]>([]);

async function load() {
  loading.value = true;
  error.value = '';
  try {
    const from = addDaysIso(todayIso(), -DAYS_BACK);
    entries.value = await provider.fetchTimeEntries({ from, to: todayIso() });
  } catch (e) {
    error.value = e instanceof ProviderNetworkError
      ? "Pas de connexion — l'historique n'a pas pu être chargé."
      : (e instanceof Error && e.message) || 'Historique indisponible.';
  } finally {
    loading.value = false;
  }
}

onMounted(load);

const byDay = computed(() => {
  const groups: Record<string, TimeEntry[]> = {};
  for (const e of entries.value) {
    const day = e.recorded_at.slice(0, 10);
    (groups[day] ||= []).push(e);
  }
  return Object.entries(groups)
    .sort((a, b) => b[0].localeCompare(a[0]))
    .map(([day, dayEntries]) => {
      const sorted = dayEntries.sort((a, b) => new Date(a.recorded_at).getTime() - new Date(b.recorded_at).getTime());
      return {
        day,
        label: new Date(day + 'T00:00:00').toLocaleDateString('fr-FR', { weekday: 'long', day: 'numeric', month: 'long' }),
        shifts: groupIntoShifts(sorted),
      };
    });
});

function entryIcon(type: TimeEntryType): string {
  if (type === 'in') return arrowBackOutline;
  if (type === 'pause_start') return pauseOutline;
  if (type === 'pause_end') return playOutline;
  return arrowForwardOutline;
}

function entryLabel(type: TimeEntryType): string {
  if (type === 'in') return 'Arrivée';
  if (type === 'pause_start') return 'Pause';
  if (type === 'pause_end') return 'Reprise';
  return 'Départ';
}

function fmtTime(iso: string): string {
  return new Date(iso).toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' });
}

async function refreshFromPull(event: CustomEvent) {
  try {
    await load();
  } finally {
    (event.target as HTMLIonRefresherElement).complete();
  }
}
</script>

<template>
  <ion-page>
    <AppHeader title="Historique des pointages" />
    <ion-content>
      <ion-refresher slot="fixed" @ionRefresh="refreshFromPull">
        <ion-refresher-content pulling-text="Tire pour rafraîchir" refreshing-spinner="crescent"></ion-refresher-content>
      </ion-refresher>
      <DataState :loading="loading" :error="error" :empty="!byDay.length" @retry="load">
        <template #empty>Aucun pointage sur les 14 derniers jours.</template>

        <div class="history">
          <template v-for="d in byDay" :key="d.day">
            <p class="day-title">{{ d.label }}</p>

            <div class="shift-card" v-for="s in d.shifts" :key="s.id">
              <div class="shift-head">
                <div>
                  <p class="shift-name">{{ s.chantierName }}</p>
                  <p class="shift-range">{{ s.endAt ? `${fmtTime(s.startAt)} – ${fmtTime(s.endAt)}` : `Arrivée ${fmtTime(s.startAt)}` }}</p>
                </div>
                <ion-badge class="duration-pill" :class="{ live: !s.endAt }">{{ fmtDuration(s.workedSeconds) }}</ion-badge>
              </div>
              <p v-if="s.pauseSeconds > 0" class="pause-note">
                <ion-icon :icon="timeOutline"></ion-icon>
                Dont {{ fmtPause(s.pauseSeconds) }} de pause décomptées
              </p>
              <div class="shift-entries">
                <div class="entry-row" v-for="e in s.entries" :key="e.id">
                  <span class="entry-icon" :class="{ in: e.type === 'in' }">
                    <ion-icon :icon="entryIcon(e.type)"></ion-icon>
                  </span>
                  <span class="entry-label">{{ entryLabel(e.type) }}</span>
                  <span class="entry-time">{{ fmtTime(e.recorded_at) }}</span>
                </div>
              </div>
            </div>
          </template>
        </div>
      </DataState>
    </ion-content>
  </ion-page>
</template>

<style scoped>
.history {
  padding: 8px 18px 24px;
}

.day-title {
  font-size: 12px;
  color: var(--text-muted);
  text-transform: capitalize;
  margin: 18px 0 8px;
}

.day-title:first-child {
  margin-top: 4px;
}

.shift-card {
  background: var(--surface-2);
  border: 1px solid var(--border);
  border-radius: 14px;
  margin-bottom: 10px;
  overflow: hidden;
}

.shift-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 10px;
  padding: 12px 14px 10px;
}

.shift-name {
  font-size: 13.5px;
  font-weight: 600;
  margin: 0;
}

.shift-range {
  font-size: 11.5px;
  color: var(--text-secondary);
  margin: 2px 0 0;
  font-variant-numeric: tabular-nums;
}

.duration-pill {
  flex-shrink: 0;
  font-size: 12px;
  font-weight: 600;
  font-variant-numeric: tabular-nums;
  --background: var(--surface-1);
  color: var(--text-secondary);
  border: 1px solid var(--border-strong);
}

.duration-pill.live {
  --background: var(--success-bg);
  color: var(--success-text);
  border-color: transparent;
}

.pause-note {
  padding: 0 14px 10px;
  margin: -2px 0 0;
  font-size: 11px;
  color: var(--warn-text);
  display: flex;
  align-items: center;
  gap: 5px;
}

.pause-note ion-icon {
  font-size: 12px;
  flex-shrink: 0;
}

.shift-entries {
  border-top: 0.5px solid var(--border);
  padding: 2px 14px;
}

.entry-row {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 7px 0;
}

.entry-row + .entry-row {
  border-top: 0.5px solid var(--border);
}

.entry-icon {
  width: 22px;
  height: 22px;
  border-radius: 50%;
  flex-shrink: 0;
  display: flex;
  align-items: center;
  justify-content: center;
  background: var(--surface-1);
  color: var(--text-muted);
  font-size: 12px;
}

.entry-icon.in {
  background: var(--success-bg);
  color: var(--success-text);
}

.entry-label {
  flex: 1;
  font-size: 12px;
  color: var(--text-secondary);
}

.entry-time {
  font-size: 12px;
  font-weight: 500;
  font-variant-numeric: tabular-nums;
}

.empty {
  text-align: center;
  color: var(--text-muted);
  margin-top: 32px;
}
</style>
