<script setup>
import { computed, onMounted, ref } from 'vue';
import { provider } from '../../providers';
import { todayIso, addDaysIso } from '../../utils/date';
import AppHeader from '../../components/AppHeader.vue';
import DataState from '../../components/DataState.vue';

const DAYS_BACK = 13; // 14 jours affichés, aujourd'hui inclus
const loading = ref(true);
const error = ref('');
const entries = ref([]);

async function load() {
  loading.value = true;
  error.value = '';
  try {
    const from = addDaysIso(todayIso(), -DAYS_BACK);
    entries.value = await provider.fetchTimeEntries({ from, to: todayIso() });
  } catch (e) {
    error.value = e.isNetworkError
      ? "Pas de connexion — l'historique n'a pas pu être chargé."
      : e.message || 'Historique indisponible.';
  } finally {
    loading.value = false;
  }
}

onMounted(load);

const byDay = computed(() => {
  const groups = {};
  for (const e of entries.value) {
    const day = e.recorded_at.slice(0, 10);
    (groups[day] ||= []).push(e);
  }
  return Object.entries(groups)
    .sort((a, b) => b[0].localeCompare(a[0]))
    .map(([day, dayEntries]) => ({
      day,
      label: new Date(day + 'T00:00:00').toLocaleDateString('fr-FR', { weekday: 'long', day: 'numeric', month: 'long' }),
      entries: dayEntries.sort((a, b) => new Date(a.recorded_at) - new Date(b.recorded_at)),
    }));
});

function entryIcon(type) {
  if (type === 'in') return 'ti-login-2';
  if (type === 'pause_start') return 'ti-player-pause';
  if (type === 'pause_end') return 'ti-player-play';
  return 'ti-logout-2';
}

function entryLabel(type) {
  if (type === 'in') return 'Arrivée';
  if (type === 'pause_start') return 'Pause';
  if (type === 'pause_end') return 'Reprise';
  return 'Départ';
}

function fmtTime(iso) {
  return new Date(iso).toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' });
}
</script>

<template>
  <AppHeader title="Historique des pointages" />

  <DataState :loading="loading" :error="error" :empty="!byDay.length" @retry="load">
    <template #empty>Aucun pointage sur les 14 derniers jours.</template>

    <div v-for="d in byDay" :key="d.day" class="history">
      <p class="history-title day-title">{{ d.label }}</p>
      <div v-for="e in d.entries" :key="e.id" class="hist-row">
        <div class="hist-icon" :class="e.type" aria-hidden="true">
          <i class="ti" :class="entryIcon(e.type)"></i>
        </div>
        <div class="hist-text">
          <p class="lbl">{{ entryLabel(e.type) }}</p>
          <p class="sub">{{ e.chantier_name }}</p>
        </div>
        <span class="hist-time">{{ fmtTime(e.recorded_at) }}</span>
      </div>
    </div>
  </DataState>
</template>

<style scoped>
.day-title {
  text-transform: capitalize;
}

.empty {
  text-align: center;
  color: var(--text-muted);
  margin-top: 32px;
}
</style>
