<script setup lang="ts">
import { computed, onMounted, ref } from 'vue';
import { IonAvatar, IonContent, IonIcon, IonItem, IonLabel, IonList, IonListHeader, IonNote, IonPage, IonRefresher, IonRefresherContent } from '@ionic/vue';
import { logInOutline, logOutOutline, pauseOutline, playOutline } from 'ionicons/icons';
import { provider } from '../../providers';
import { ProviderNetworkError } from '../../providers/DataProvider';
import { todayIso, addDaysIso } from '../../utils/date';
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
    .map(([day, dayEntries]) => ({
      day,
      label: new Date(day + 'T00:00:00').toLocaleDateString('fr-FR', { weekday: 'long', day: 'numeric', month: 'long' }),
      entries: dayEntries.sort((a, b) => new Date(a.recorded_at).getTime() - new Date(b.recorded_at).getTime()),
    }));
});

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

        <ion-list v-for="d in byDay" :key="d.day" class="history" lines="none">
          <ion-list-header class="day-title"><ion-label>{{ d.label }}</ion-label></ion-list-header>
          <ion-item v-for="e in d.entries" :key="e.id" class="hist-row">
            <ion-avatar slot="start" class="hist-icon" :class="e.type" aria-hidden="true">
              <ion-icon :icon="entryIcon(e.type)"></ion-icon>
            </ion-avatar>
            <ion-label>
              <p class="lbl">{{ entryLabel(e.type) }}</p>
              <p class="sub">{{ e.chantier_name }}</p>
            </ion-label>
            <ion-note slot="end" class="hist-time">{{ fmtTime(e.recorded_at) }}</ion-note>
          </ion-item>
        </ion-list>
      </DataState>
    </ion-content>
  </ion-page>
</template>

<style scoped>
.day-title {
  --color: var(--text-muted);
  font-size: 12px;
  text-transform: capitalize;
  min-height: 0;
  margin: 0 0 4px;
}

.empty {
  text-align: center;
  color: var(--text-muted);
  margin-top: 32px;
}
</style>
