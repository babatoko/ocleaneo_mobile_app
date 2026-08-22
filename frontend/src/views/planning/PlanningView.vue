<script setup>
import { computed, nextTick, onMounted, onUnmounted, ref, watch } from 'vue';
import { useRouter } from 'vue-router';
import { useAuthStore } from '../../stores/auth';
import { useChantiersStore } from '../../stores/chantiers';
import { usePlanningStore } from '../../stores/planning';
import { getCurrentPosition, getOptimizedTrip } from '../../services/osrm';
import { turnByTurnHref } from '../../services/navigation';
import { exportShiftsToCalendar } from '../../services/calendarExport';
import { startOfWeekIso, startOfMonthIso, endOfMonthIso } from '../../utils/week';

const router = useRouter();
const auth = useAuthStore();
const chantiers = useChantiersStore();
const planning = usePlanningStore();
const view = ref('jour'); // 'jour' | 'semaine' | 'mois' | 'tournee'
const selectedDate = ref(toIso(new Date()));
const monthAnchor = ref(toIso(new Date()));
const exportError = ref('');

function toIso(date) {
  return date.toISOString().slice(0, 10);
}

function startOfWeek(dateIso) {
  return new Date(startOfWeekIso(dateIso) + 'T00:00:00');
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
  await planning.loadDay(selectedDate.value);
}

async function loadWeek() {
  const start = weekDays.value[0];
  const end = weekDays.value[weekDays.value.length - 1];
  await planning.loadWeek(toIso(start), toIso(end));
}

// --- Vue Mois -------------------------------------------------------------

const monthGridWeeks = computed(() => {
  const first = new Date(startOfMonthIso(monthAnchor.value) + 'T00:00:00');
  const last = new Date(endOfMonthIso(monthAnchor.value) + 'T00:00:00');
  const gridStart = startOfWeek(toIso(first));
  const gridEnd = startOfWeek(toIso(last));
  gridEnd.setDate(gridEnd.getDate() + 6);

  const days = [];
  for (let d = new Date(gridStart); d <= gridEnd; d.setDate(d.getDate() + 1)) {
    days.push(new Date(d));
  }
  const weeks = [];
  for (let i = 0; i < days.length; i += 7) weeks.push(days.slice(i, i + 7));
  return weeks;
});

const monthLabel = computed(() =>
  new Date(monthAnchor.value + 'T00:00:00').toLocaleDateString('fr-FR', { month: 'long', year: 'numeric' })
);

function shiftsCountForDay(dateIso) {
  return planning.monthShifts.filter((s) => s.start_at.slice(0, 10) === dateIso).length;
}

function isCurrentMonth(date) {
  return toIso(date).slice(0, 7) === monthAnchor.value.slice(0, 7);
}

function shiftMonth(delta) {
  const d = new Date(monthAnchor.value + 'T00:00:00');
  d.setMonth(d.getMonth() + delta, 1);
  monthAnchor.value = toIso(d);
  loadMonth();
}

async function loadMonth() {
  await planning.loadMonth(monthAnchor.value);
}

function refresh() {
  if (view.value === 'jour') loadDay();
  else if (view.value === 'semaine') loadWeek();
  else if (view.value === 'mois') loadMonth();
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

// Coordonnées du chantier si connues (guidage direct) — sinon repli sur
// l'adresse texte (simple recherche, pas de guidage).
function itineraryHref(shift) {
  const chantier = chantiers.list.find((c) => c.id === shift.chantier_id);
  return turnByTurnHref({
    latitude: chantier?.latitude,
    longitude: chantier?.longitude,
    address: shift.chantier_address || shift.chantier_name,
  });
}

async function exportToCalendar(shiftsToExport, filename) {
  exportError.value = '';
  try {
    await exportShiftsToCalendar(shiftsToExport, filename);
  } catch (e) {
    exportError.value = e.message || "Export impossible.";
  }
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
    const dayShifts = await planning.loadDay(selectedDate.value).then(() => planning.dayShifts);

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
onMounted(async () => {
  if (!auth.employee) auth.fetchMe();
  await chantiers.fetchMine(); // pour les liens Itinéraire avec guidage direct (coordonnées)
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

  <div class="view-toggle four">
    <button class="opt" :class="{ active: view === 'jour' }" @click="view = 'jour'">Jour</button>
    <button class="opt" :class="{ active: view === 'semaine' }" @click="view = 'semaine'">Semaine</button>
    <button class="opt" :class="{ active: view === 'mois' }" @click="view = 'mois'">Mois</button>
    <button class="opt" :class="{ active: view === 'tournee' }" @click="view = 'tournee'">Tournée</button>
  </div>

  <p v-if="exportError" class="export-error"><i class="ti ti-alert-circle"></i> {{ exportError }}</p>

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

    <div class="shift" v-for="s in planning.dayShifts" :key="s.id">
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
          <a :href="itineraryHref(s)" target="_blank" rel="noopener" @click.stop>
            <i class="ti ti-map-2"></i> Itinéraire
          </a>
          <button type="button" @click.stop="exportToCalendar([s], `vacation-${s.id}.ics`)">
            <i class="ti ti-calendar-plus"></i> Calendrier
          </button>
        </div>
      </div>
    </div>
    <p v-if="!planning.loading && !planning.dayShifts.length" class="empty">Aucune vacation ce jour-là.</p>
  </div>

  <div v-else-if="view === 'semaine'" class="week">
    <button
      v-if="Object.values(planning.weekShiftsByDay).flat().length"
      type="button"
      class="export-week-btn"
      @click="exportToCalendar(Object.values(planning.weekShiftsByDay).flat(), 'planning-semaine.ics')"
    >
      <i class="ti ti-calendar-plus"></i> Exporter la semaine
    </button>

    <div v-for="d in weekDays" :key="toIso(d)" class="week-day">
      <div class="week-day-head" @click="pickDay(d)">
        <strong>{{ d.toLocaleDateString('fr-FR', { weekday: 'long', day: 'numeric', month: 'short' }) }}</strong>
        <span class="count">{{ (planning.weekShiftsByDay[toIso(d)] || []).length }}</span>
      </div>
      <div v-for="s in planning.weekShiftsByDay[toIso(d)] || []" :key="s.id" class="week-shift">
        <span class="ws-info" @click="openDetail(s)">
          {{ timeRange(s) }} · {{ s.chantier_name }}
          <span v-if="s.status === 'modified'" class="ws-badge">modifié</span>
        </span>
        <a class="ws-itin" :href="itineraryHref(s)" target="_blank" rel="noopener" @click.stop>
          <i class="ti ti-map-2"></i>
        </a>
      </div>
    </div>
  </div>

  <div v-else-if="view === 'mois'" class="month">
    <div class="month-nav">
      <button type="button" @click="shiftMonth(-1)"><i class="ti ti-chevron-left"></i></button>
      <strong>{{ monthLabel }}</strong>
      <button type="button" @click="shiftMonth(1)"><i class="ti ti-chevron-right"></i></button>
    </div>
    <div class="month-weekdays">
      <span v-for="wd in ['L', 'M', 'M', 'J', 'V', 'S', 'D']" :key="wd">{{ wd }}</span>
    </div>
    <div class="month-grid">
      <template v-for="(w, wi) in monthGridWeeks" :key="wi">
        <button
          v-for="d in w"
          :key="toIso(d)"
          type="button"
          class="month-cell"
          :class="{ dim: !isCurrentMonth(d), today: toIso(d) === toIso(new Date()) }"
          @click="pickDay(d)"
        >
          <span class="mc-num">{{ d.getDate() }}</span>
          <span class="mc-dot" :class="{ hidden: !shiftsCountForDay(toIso(d)) }"></span>
        </button>
      </template>
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

      <a
        class="start-nav-btn"
        :href="turnByTurnHref({ latitude: tripStops[0].latitude, longitude: tripStops[0].longitude, address: tripStops[0].address })"
        target="_blank"
        rel="noopener"
      >
        <i class="ti ti-navigation"></i> Démarrer la navigation vers {{ tripStops[0].name }}
      </a>

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
.view-toggle.four .opt {
  font-size: 11px;
  padding: 7px 0;
}

.export-error {
  display: flex;
  align-items: center;
  gap: 6px;
  margin: 0 18px 8px;
  font-size: 12px;
  color: var(--danger);
}

.week {
  padding: 0 18px 18px;
}

.export-week-btn {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 6px;
  width: 100%;
  font-size: 13px;
  font-weight: 500;
  color: var(--accent-text);
  background: var(--accent-bg);
  border: none;
  border-radius: 10px;
  padding: 10px;
  margin-bottom: 12px;
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
  cursor: pointer;
}

.count {
  font-size: 11px;
  color: var(--text-muted);
}

.week-shift {
  display: flex;
  align-items: center;
  gap: 8px;
  font-size: 12px;
  color: var(--text-secondary);
  margin-top: 6px;
}

.week-shift .ws-info {
  flex: 1;
  cursor: pointer;
}

.ws-badge {
  font-size: 10px;
  font-weight: 500;
  color: var(--warn-text);
  background: var(--warn-bg);
  padding: 1px 6px;
  border-radius: 6px;
  margin-left: 6px;
}

.ws-itin {
  color: var(--accent-text);
  flex-shrink: 0;
  font-size: 14px;
}

.empty {
  text-align: center;
  color: var(--text-muted);
  margin-top: 32px;
}

/* Vue Mois */

.month {
  padding: 0 18px 18px;
}

.month-nav {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-bottom: 12px;
}

.month-nav strong {
  font-size: 14px;
  text-transform: capitalize;
}

.month-nav button {
  width: 32px;
  height: 32px;
  border-radius: 50%;
  border: none;
  background: var(--surface-1);
  color: var(--text-primary);
}

.month-weekdays {
  display: grid;
  grid-template-columns: repeat(7, 1fr);
  text-align: center;
  font-size: 10px;
  color: var(--text-muted);
  margin-bottom: 4px;
}

.month-grid {
  display: grid;
  grid-template-columns: repeat(7, 1fr);
  gap: 4px;
}

.month-cell {
  aspect-ratio: 1;
  border: none;
  background: none;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 3px;
  border-radius: 10px;
  color: var(--text-primary);
}

.month-cell.dim {
  color: var(--text-muted);
  opacity: 0.5;
}

.month-cell.today .mc-num {
  background: var(--text-primary);
  color: #fff;
  border-radius: 50%;
  width: 22px;
  height: 22px;
  display: flex;
  align-items: center;
  justify-content: center;
}

.mc-num {
  font-size: 12px;
}

.mc-dot {
  width: 4px;
  height: 4px;
  border-radius: 50%;
  background: var(--accent);
}

.mc-dot.hidden {
  visibility: hidden;
}

/* Tournée */

.start-nav-btn {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 8px;
  margin: 0 18px 14px;
  background: var(--text-primary);
  color: #fff;
  border-radius: 12px;
  padding: 12px;
  font-size: 13px;
  font-weight: 500;
  text-decoration: none;
}
</style>
