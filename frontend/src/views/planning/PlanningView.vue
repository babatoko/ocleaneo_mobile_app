<script setup>
import { computed, nextTick, onMounted, onUnmounted, ref, watch } from 'vue';
import { useRouter } from 'vue-router';
import { api } from '../../services/api';
import { useAuthStore } from '../../stores/auth';
import { useChantiersStore } from '../../stores/chantiers';
import { usePlanningStore } from '../../stores/planning';
import { getCurrentPosition, getOptimizedTrip } from '../../services/osrm';

const router = useRouter();
const auth = useAuthStore();
const chantiers = useChantiersStore();
const planning = usePlanningStore();
const view = ref('jour'); // 'jour' | 'semaine' | 'tournee'
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

// Bandeau de dates de la vue Jour : toujours ancré sur aujourd'hui à gauche,
// suivi des 6 jours suivants — pas une semaine calendaire (qui peut placer
// aujourd'hui n'importe où, y compris tout à droite).
const dayStrip = computed(() => {
  const start = new Date(toIso(new Date()) + 'T00:00:00');
  return Array.from({ length: 7 }, (_, i) => {
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
  else if (view.value === 'semaine') loadWeek();
  else loadTournee();
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

function openDetail(shift) {
  planning.selectShift(shift);
  router.push({ name: 'planning-chantier', params: { id: shift.id }, query: { date: selectedDate.value } });
}

// --- Tournée : itinéraire optimisé (OSRM) -------------------------------

const tripLoading = ref(false);
const tripError = ref('');
const tripStops = ref([]); // stops avec ETA/départ calculés, dans l'ordre optimisé
const tripDistanceMeters = ref(0);
const tripDurationSeconds = ref(0);
const missingCoords = ref([]);
const mapEl = ref(null);
let map = null;
let L = null;

function fmtKm(meters) {
  return meters >= 1000 ? `${(meters / 1000).toFixed(0)} km` : `${Math.round(meters)} m`;
}

function fmtDuration(seconds) {
  const h = Math.floor(seconds / 3600);
  const m = Math.round((seconds % 3600) / 60);
  return h > 0 ? `${h}h${String(m).padStart(2, '0')}` : `${m} min`;
}

function fmtTime(date) {
  return date.toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' });
}

async function loadTournee() {
  tripError.value = '';
  tripStops.value = [];
  missingCoords.value = [];
  tripLoading.value = true;
  try {
    await chantiers.fetchMine();
    const { data: dayShifts } = await api.get('/shifts/mine', {
      params: { from: selectedDate.value, to: selectedDate.value },
    });

    const withCoords = [];
    for (const s of dayShifts) {
      const chantier = chantiers.list.find((c) => c.id === s.chantier_id);
      if (chantier?.latitude && chantier?.longitude) {
        withCoords.push({
          id: s.chantier_id,
          name: s.chantier_name,
          address: s.chantier_address,
          latitude: chantier.latitude,
          longitude: chantier.longitude,
          shiftDurationSeconds:
            (new Date(s.end_at).getTime() - new Date(s.start_at).getTime()) / 1000,
          startAt: s.start_at,
        });
      } else {
        missingCoords.value.push(s.chantier_name);
      }
    }

    if (withCoords.length < 2) {
      tripLoading.value = false;
      return;
    }

    const current = await getCurrentPosition();
    const points = current
      ? [{ id: 'me', name: 'Position actuelle', ...current }, ...withCoords]
      : withCoords;

    const trip = await getOptimizedTrip(points);

    let clock = current
      ? new Date()
      : new Date(withCoords.sort((a, b) => a.startAt.localeCompare(b.startAt))[0].startAt);

    const stops = [];
    for (const stop of trip.order) {
      if (stop.id === 'me') {
        // Pas un arrêt à afficher : juste avancer l'horloge du trajet vers le 1er site.
        clock = new Date(clock.getTime() + (stop.legDurationSeconds || 0) * 1000);
        continue;
      }
      const arrival = new Date(clock.getTime());
      const dwell = stop.shiftDurationSeconds || 30 * 60;
      const departure = new Date(arrival.getTime() + dwell * 1000);
      stops.push({ ...stop, arrival, departure });
      clock = new Date(departure.getTime() + (stop.legDurationSeconds || 0) * 1000);
    }

    tripStops.value = stops;
    tripDistanceMeters.value = trip.distanceMeters;
    tripDurationSeconds.value = trip.durationSeconds;

    await nextTick();
    renderMap(trip.geometry, stops, current);
  } catch (e) {
    tripError.value = e.message || "Impossible de calculer l'itinéraire.";
  } finally {
    tripLoading.value = false;
  }
}

async function renderMap(geometry, stops, current) {
  if (!mapEl.value) return;
  if (!L) {
    await import('leaflet/dist/leaflet.css');
    L = await import('leaflet');
  }

  if (map) {
    map.remove();
    map = null;
  }

  map = L.map(mapEl.value, { zoomControl: false, attributionControl: false });
  L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
    maxZoom: 19,
  }).addTo(map);

  const points = [];
  if (current) {
    L.marker([current.latitude, current.longitude], {
      icon: L.divIcon({
        className: '',
        html: '<div class="trip-marker start"><i class="ti ti-navigation"></i></div>',
        iconSize: [24, 24],
      }),
    }).addTo(map);
    points.push([current.latitude, current.longitude]);
  }

  stops.forEach((stop, i) => {
    L.marker([stop.latitude, stop.longitude], {
      icon: L.divIcon({
        className: '',
        html: `<div class="trip-marker">${i + 1}</div>`,
        iconSize: [24, 24],
      }),
    }).addTo(map);
    points.push([stop.latitude, stop.longitude]);
  });

  if (geometry?.length) {
    L.polyline(geometry, { color: '#0f6e56', weight: 4, opacity: 0.85 }).addTo(map);
  }

  const bounds = L.latLngBounds(geometry?.length ? geometry : points);
  map.fitBounds(bounds, { padding: [24, 24] });
}

function destroyMap() {
  if (map) {
    map.remove();
    map = null;
  }
}

watch(view, (v, prev) => {
  if (prev === 'tournee') destroyMap();
  refresh();
});
onMounted(() => {
  if (!auth.employee) auth.fetchMe();
  refresh();
});
onUnmounted(destroyMap);
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
    <button class="opt" :class="{ active: view === 'tournee' }" @click="view = 'tournee'">Tournée</button>
  </div>

  <div v-if="view === 'jour'">
    <div class="days">
      <button
        v-for="d in dayStrip"
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
      <div class="card" @click="openDetail(s)">
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
          <a :href="mapLink(s.chantier_address || s.chantier_name)" target="_blank" rel="noopener" @click.stop>
            <i class="ti ti-map-2"></i> Itinéraire
          </a>
        </div>
      </div>
    </div>
    <p v-if="!loading && !shifts.length" class="empty">Aucune vacation ce jour-là.</p>
  </div>

  <div v-else-if="view === 'semaine'" class="week">
    <div v-for="d in weekDays" :key="toIso(d)" class="week-day" @click="pickDay(d)">
      <div class="week-day-head">
        <strong>{{ d.toLocaleDateString('fr-FR', { weekday: 'long', day: 'numeric', month: 'short' }) }}</strong>
        <span class="count">{{ (weekShiftsByDay[toIso(d)] || []).length }}</span>
      </div>
      <div v-for="s in weekShiftsByDay[toIso(d)] || []" :key="s.id" class="week-shift" @click.stop="openDetail(s)">
        {{ timeRange(s) }} · {{ s.chantier_name }}
      </div>
    </div>
  </div>

  <div v-else>
    <p class="section-title">{{ selectedDateLabel }} — {{ tripStops.length }} site{{ tripStops.length > 1 ? 's' : '' }}</p>

    <template v-if="tripStops.length">
      <div ref="mapEl" class="map-wrap"></div>

      <div class="map-summary-bar">
        <div class="sitem"><i class="ti ti-route"></i> {{ fmtKm(tripDistanceMeters) }}</div>
        <div class="sitem"><i class="ti ti-clock"></i> {{ fmtDuration(tripDurationSeconds) }} trajet</div>
        <div class="optimize-badge"><i class="ti ti-sparkles"></i> Optimisée</div>
      </div>

      <div v-for="(s, i) in tripStops" :key="s.id" class="stop-row">
        <div class="stop-num">{{ i + 1 }}</div>
        <div class="stop-card">
          <div class="stop-top">
            <p class="sname">{{ s.name }}</p>
            <p class="seta">{{ fmtTime(s.arrival) }} - {{ fmtTime(s.departure) }}</p>
          </div>
          <p v-if="s.address" class="saddr">{{ s.address }}</p>
        </div>
      </div>
    </template>

    <p v-else-if="tripLoading" class="trip-empty">Calcul de l'itinéraire optimisé…</p>
    <p v-else-if="tripError" class="trip-empty">{{ tripError }}</p>
    <p v-else-if="missingCoords.length" class="trip-empty">
      Coordonnées GPS manquantes pour {{ missingCoords.join(', ') }} — à renseigner sur la fiche
      chantier dans Odoo pour calculer la tournée.
    </p>
    <p v-else class="trip-empty">Pas assez de sites planifiés ce jour-là pour une tournée.</p>
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
  cursor: pointer;
}

.empty {
  text-align: center;
  color: var(--text-muted);
  margin-top: 32px;
}
</style>
