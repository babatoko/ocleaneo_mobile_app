<script setup lang="ts">
import { computed, nextTick, onMounted, onUnmounted, ref, watch } from 'vue';
import { useRouter } from 'vue-router';
import {
  IonBadge,
  IonButton,
  IonCard,
  IonCardContent,
  IonCardHeader,
  IonCardSubtitle,
  IonCardTitle,
  IonChip,
  IonContent,
  IonIcon,
  IonItem,
  IonLabel,
  IonList,
  IonPage,
  IonRefresher,
  IonRefresherContent,
  IonSegment,
  IonSegmentButton,
} from '@ionic/vue';
import type { SegmentChangeEventDetail } from '@ionic/core';
import {
  alertCircleOutline,
  calendarOutline,
  chevronBackOutline,
  chevronForwardOutline,
  locationOutline,
  mapOutline,
  navigateOutline,
  sparklesOutline,
  timeOutline,
} from 'ionicons/icons';
import { useAuthStore } from '../../stores/auth';
import { useChantiersStore } from '../../stores/chantiers';
import { usePlanningStore } from '../../stores/planning';
import { getCurrentPosition, getOptimizedTrip, type TripPoint } from '../../services/osrm';
import { turnByTurnHref } from '../../services/navigation';
import { exportShiftsToCalendar } from '../../services/calendarExport';
import { startOfWeekIso, startOfMonthIso, endOfMonthIso } from '../../utils/week';
import { toLocalIso, todayIso, addDaysIso } from '../../utils/date';
import { provider } from '../../providers';
import DataState from '../../components/DataState.vue';
import type { Shift } from '../../types/models';

type PlanningTab = 'jour' | 'semaine' | 'mois' | 'tournee';

const router = useRouter();
const auth = useAuthStore();
const chantiers = useChantiersStore();
const planning = usePlanningStore();
const view = ref<PlanningTab>('jour');
const selectedDate = ref(todayIso());
const monthAnchor = ref(todayIso());
const exportError = ref('');
const todayIsoValue = todayIso();

const toIso = toLocalIso;

function startOfWeek(dateIso: string): Date {
  return new Date(startOfWeekIso(dateIso) + 'T00:00:00');
}

// Semaine complète du lundi au dimanche : une vacation programmée un dimanche
// existe dans la vue Mois, elle doit aussi être visible ici.
const weekDays = computed(() => {
  const start = startOfWeek(selectedDate.value);
  return Array.from({ length: 7 }, (_, i) => {
    const d = new Date(start);
    d.setDate(start.getDate() + i);
    return d;
  });
});

// Bandeau de dates de la vue Jour : toujours ancré sur aujourd'hui à gauche,
// suivi des 6 jours suivants — pas une semaine calendaire (qui peut placer
// aujourd'hui n'importe où, y compris tout à droite).
const dayStrip = computed(() => {
  const start = new Date(todayIsoValue + 'T00:00:00');
  return Array.from({ length: 7 }, (_, i) => {
    const d = new Date(start);
    d.setDate(start.getDate() + i);
    return d;
  });
});

// Nombre de vacations par jour sur la fenêtre du bandeau : permet d'afficher
// la pastille « ce jour-là a du travail » sans avoir à ouvrir chaque journée.
const stripCounts = ref<Record<string, number>>({}); // 'AAAA-MM-JJ' -> nombre de vacations

async function loadStripCounts() {
  const from = todayIsoValue;
  const to = addDaysIso(from, 6);
  try {
    const shifts = await provider.fetchShifts({ from, to });
    const counts: Record<string, number> = {};
    for (const s of shifts) {
      const day = s.start_at.slice(0, 10);
      counts[day] = (counts[day] || 0) + 1;
    }
    stripCounts.value = counts;
  } catch {
    // Indicateur purement informatif : son échec ne doit rien casser à l'écran.
    stripCounts.value = {};
  }
}

function dayCellLabel(d: Date): string {
  const n = shiftsCountForDay(toIso(d));
  const date = d.toLocaleDateString('fr-FR', { weekday: 'long', day: 'numeric', month: 'long' });
  if (!n) return `${date}, aucune vacation`;
  return `${date}, ${n} vacation${n > 1 ? 's' : ''}`;
}

function dayStripLabel(d: Date): string {
  const n = stripCounts.value[toIso(d)] || 0;
  const date = d.toLocaleDateString('fr-FR', { weekday: 'long', day: 'numeric', month: 'long' });
  if (!n) return `${date}, aucune vacation`;
  return `${date}, ${n} vacation${n > 1 ? 's' : ''}`;
}

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

function shiftsCountForDay(dateIso: string): number {
  return planning.monthShifts.filter((s) => s.start_at.slice(0, 10) === dateIso).length;
}

function isCurrentMonth(date: Date): boolean {
  return toIso(date).slice(0, 7) === monthAnchor.value.slice(0, 7);
}

function shiftMonth(delta: number) {
  const d = new Date(monthAnchor.value + 'T00:00:00');
  d.setMonth(d.getMonth() + delta, 1);
  monthAnchor.value = toIso(d);
  loadMonth();
}

async function loadMonth() {
  await planning.loadMonth(monthAnchor.value);
}

async function refresh() {
  if (view.value === 'jour') loadDay();
  else if (view.value === 'semaine') loadWeek();
  else if (view.value === 'mois') loadMonth();
  else loadTournee();
}

// Pull-to-refresh : recharge la vue courante ET les pastilles du bandeau de
// jours — sinon un ajout côté Odoo (un responsable qui pose un ordre pour
// demain) n'apparaît qu'en quittant/rouvrant l'écran.
async function refreshFromPull(event: CustomEvent) {
  try {
    await Promise.all([Promise.resolve(refresh()), Promise.resolve(loadStripCounts())]);
  } finally {
    (event.target as HTMLIonRefresherElement).complete();
  }
}

// Taper un onglet revient toujours à la période courante (aujourd'hui /
// semaine courante / mois courant), quelle que soit la date affichée avant
// le tap — contrairement au zoom par pincement (zoomIn/zoomOut) qui doit
// lui préserver la position temporelle.
function onViewChange(e: CustomEvent<SegmentChangeEventDetail>) {
  const next = e.detail.value as PlanningTab | undefined;
  if (!next) return;
  view.value = next;
  if (next === 'jour' || next === 'semaine') selectedDate.value = todayIsoValue;
  else if (next === 'mois') monthAnchor.value = todayIsoValue;
}

// --- Navigation gestuelle (glisser / pincer) -------------------------------
// Glisser le bord droit vers la gauche avance dans le temps, glisser le bord
// gauche vers la droite recule — mappé sur goPeriod(1)/(-1). Le pincement à
// deux doigts change de granularité (zoomOut : Jour → Semaine → Mois, en
// resserrant ; zoomIn : l'inverse, en écartant), sans toucher à la date
// affichée — seul un tap d'onglet (onViewChange) doit recentrer sur
// aujourd'hui.
const ZOOM_LEVELS: PlanningTab[] = ['jour', 'semaine', 'mois'];
const SWIPE_PX = 46;
const PINCH_PX = 34;

function goPeriod(dir: 1 | -1) {
  if (view.value === 'jour') selectedDate.value = addDaysIso(selectedDate.value, dir);
  else if (view.value === 'semaine') selectedDate.value = addDaysIso(selectedDate.value, dir * 7);
  else if (view.value === 'mois') shiftMonth(dir);
}

function zoomOut() {
  const i = ZOOM_LEVELS.indexOf(view.value);
  if (i >= 0 && i < ZOOM_LEVELS.length - 1) view.value = ZOOM_LEVELS[i + 1];
}

function zoomIn() {
  const i = ZOOM_LEVELS.indexOf(view.value);
  if (i > 0) view.value = ZOOM_LEVELS[i - 1];
}

let touchStartX = 0;
let touchStartY = 0;
let touchStartDist = 0;
let gestureHandled = false;

function touchDistance(touches: TouchList): number {
  return Math.hypot(
    touches[0].clientX - touches[1].clientX,
    touches[0].clientY - touches[1].clientY
  );
}

function onTouchStart(e: TouchEvent) {
  gestureHandled = false;
  if (e.touches.length === 2) {
    touchStartDist = touchDistance(e.touches);
  } else if (e.touches.length === 1) {
    touchStartX = e.touches[0].clientX;
    touchStartY = e.touches[0].clientY;
    touchStartDist = 0;
  }
}

// Tournée n'est pas concernée par la spec de navigation gestuelle (pas de
// notion de "période précédente/suivante" pour un itinéraire du jour).
function onTouchMove(e: TouchEvent) {
  if (gestureHandled || view.value === 'tournee') return;
  if (e.touches.length === 2 && touchStartDist) {
    const delta = touchDistance(e.touches) - touchStartDist;
    if (Math.abs(delta) > PINCH_PX) {
      gestureHandled = true;
      if (delta < 0) zoomOut();
      else zoomIn();
    }
  } else if (e.touches.length === 1) {
    const dx = e.touches[0].clientX - touchStartX;
    const dy = e.touches[0].clientY - touchStartY;
    if (Math.abs(dx) > SWIPE_PX && Math.abs(dx) > Math.abs(dy) * 1.4) {
      gestureHandled = true;
      goPeriod(dx < 0 ? 1 : -1);
    }
  }
}

function onTouchEnd() {
  touchStartDist = 0;
  gestureHandled = false;
}

function pickDay(date: Date) {
  selectedDate.value = toIso(date);
  view.value = 'jour';
}

function badgeColor(status: string): string {
  if (status === 'confirmed') return 'success';
  if (status === 'modified' || status === 'pending') return 'warning';
  if (status === 'cancelled') return 'danger';
  return 'medium';
}

function timeRange(shift: Shift): string {
  const fmt = (iso: string) =>
    new Date(iso).toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' });
  return `${fmt(shift.start_at)} - ${fmt(shift.end_at)}`;
}

// Coordonnées du chantier si connues (guidage direct) — sinon repli sur
// l'adresse texte (simple recherche, pas de guidage).
function itineraryHref(shift: Shift): string {
  const chantier = chantiers.list.find((c) => c.id === shift.chantier_id);
  return turnByTurnHref({
    latitude: chantier?.latitude,
    longitude: chantier?.longitude,
    address: shift.chantier_address || shift.chantier_name,
  });
}

async function exportToCalendar(shiftsToExport: Shift[], filename: string) {
  exportError.value = '';
  try {
    await exportShiftsToCalendar(shiftsToExport, filename);
  } catch (e) {
    exportError.value = (e instanceof Error && e.message) || "Export impossible.";
  }
}

function openDetail(shift: Shift) {
  planning.selectShift(shift);
  router.push({ name: 'planning-chantier', params: { id: shift.id }, query: { date: selectedDate.value } });
}

// --- Tournée : itinéraire optimisé (OSRM) -------------------------------

interface TrippablePoint extends TripPoint {
  address?: string;
  shiftDurationSeconds?: number;
  startAt?: string;
}

interface TripStopWithSchedule extends TrippablePoint {
  tripIndex: number;
  legDurationSeconds: number;
  legDistanceMeters: number;
  arrival: Date;
  departure: Date;
}

const tripLoading = ref(false);
const tripError = ref('');
const tripStops = ref<TripStopWithSchedule[]>([]); // stops avec ETA/départ calculés, dans l'ordre optimisé
const tripDistanceMeters = ref(0);
const tripDurationSeconds = ref(0);
const missingCoords = ref<string[]>([]);
const mapEl = ref<HTMLElement | null>(null);
let map: import('leaflet').Map | null = null;
let L: typeof import('leaflet') | null = null;

function fmtKm(meters: number): string {
  return meters >= 1000 ? `${(meters / 1000).toFixed(0)} km` : `${Math.round(meters)} m`;
}

function fmtDuration(seconds: number): string {
  const h = Math.floor(seconds / 3600);
  const m = Math.round((seconds % 3600) / 60);
  return h > 0 ? `${h}h${String(m).padStart(2, '0')}` : `${m} min`;
}

function fmtTime(date: Date): string {
  return date.toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' });
}

async function loadTournee() {
  tripError.value = '';
  tripStops.value = [];
  missingCoords.value = [];
  tripLoading.value = true;
  try {
    await chantiers.fetchMine();
    await planning.loadDay(selectedDate.value);
    // loadDay ne lève plus : c'est le store qui porte l'erreur, il faut donc
    // la relayer ici plutôt que de calculer une tournée sur une liste vide.
    if (planning.error) {
      tripError.value = planning.error;
      return;
    }
    const dayShifts = planning.dayShifts;

    const withCoords: Required<Pick<TrippablePoint, 'id' | 'name' | 'address' | 'latitude' | 'longitude' | 'shiftDurationSeconds' | 'startAt'>>[] = [];
    for (const s of dayShifts) {
      const chantier = chantiers.list.find((c) => c.id === s.chantier_id);
      // `!= null` : 0 est une coordonnée réelle (équateur/méridien), pas une
      // valeur "manquante" — même correction que checkGeofence().
      if (chantier?.latitude != null && chantier?.longitude != null) {
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
    const points: TrippablePoint[] = current
      ? [{ id: 'me', name: 'Position actuelle', ...current }, ...withCoords]
      : withCoords;

    const trip = await getOptimizedTrip(points);

    let clock = current
      ? new Date()
      : new Date(withCoords.sort((a, b) => a.startAt.localeCompare(b.startAt))[0].startAt);

    const stops: TripStopWithSchedule[] = [];
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
    tripError.value = (e instanceof Error && e.message) || "Impossible de calculer l'itinéraire.";
  } finally {
    tripLoading.value = false;
  }
}

async function renderMap(
  geometry: [number, number][],
  stops: TripStopWithSchedule[],
  current: { latitude: number; longitude: number } | null
) {
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

  const points: [number, number][] = [];
  if (current) {
    // Marqueur Leaflet : du HTML brut injecté hors du rendu Vue, donc pas
    // d'<ion-icon> (chargerait son SVG à distance sans registre local) — la
    // même constante ionicons est réutilisable directement comme <img>, elle
    // est déjà une data URI SVG.
    L.marker([current.latitude, current.longitude], {
      icon: L.divIcon({
        className: '',
        html: `<div class="trip-marker start"><img src="${navigateOutline}" alt="" width="14" height="14" /></div>`,
        iconSize: [24, 24],
      }),
    }).addTo(map);
    points.push([current.latitude, current.longitude]);
  }

  stops.forEach((stop, i) => {
    L!.marker([stop.latitude, stop.longitude], {
      icon: L!.divIcon({
        className: '',
        html: `<div class="trip-marker">${i + 1}</div>`,
        iconSize: [24, 24],
      }),
    }).addTo(map!);
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

watch(view, (_v, prev) => {
  if (prev === 'tournee') destroyMap();
  refresh();
});
// Changer de jour dans le bandeau (ou par glissement) doit recharger la vue
// jour (et la tournée, qui est un jour particulier aussi) — sinon on reste
// sur les vacations du jour précédent. La vue semaine n'avait jusqu'ici
// aucune façon de changer de semaine ; le glissement en ajoute une, donc
// elle doit maintenant réagir aux changements de selectedDate aussi.
watch(selectedDate, () => {
  if (view.value === 'jour' || view.value === 'tournee') refresh();
  else if (view.value === 'semaine') loadWeek();
});
onMounted(async () => {
  if (!auth.employee) auth.fetchMe();
  // Les coordonnées servent aux liens Itinéraire avec guidage direct ; leur
  // absence ne doit pas empêcher l'affichage du planning lui-même.
  await chantiers.fetchMine().catch(() => {});
  loadStripCounts();
  refresh();
});
onUnmounted(destroyMap);
</script>

<template>
  <ion-page>
    <ion-content
      @touchstart="onTouchStart"
      @touchmove="onTouchMove"
      @touchend="onTouchEnd"
      @touchcancel="onTouchEnd"
    >
      <ion-refresher slot="fixed" @ionRefresh="refreshFromPull">
        <ion-refresher-content pulling-text="Tire pour rafraîchir" refreshing-spinner="crescent"></ion-refresher-content>
      </ion-refresher>
  <div class="header">
    <div>
      <p class="hello">Bonjour</p>
      <p class="name">{{ auth.employee?.name || '' }}</p>
    </div>
    <div class="avatar">{{ initials }}</div>
  </div>

  <ion-segment class="view-toggle four" :value="view" @ion-change="onViewChange">
    <ion-segment-button value="jour"><ion-label>Jour</ion-label></ion-segment-button>
    <ion-segment-button value="semaine"><ion-label>Semaine</ion-label></ion-segment-button>
    <ion-segment-button value="mois"><ion-label>Mois</ion-label></ion-segment-button>
    <ion-segment-button value="tournee"><ion-label>Tournée</ion-label></ion-segment-button>
  </ion-segment>

  <p v-if="exportError" class="export-error"><ion-icon :icon="alertCircleOutline"></ion-icon> {{ exportError }}</p>

  <div v-if="view === 'jour'">
    <div class="days">
      <button
        v-for="d in dayStrip"
        :key="toIso(d)"
        class="day"
        :class="{ active: toIso(d) === selectedDate }"
        :aria-label="dayStripLabel(d)"
        :aria-current="toIso(d) === selectedDate ? 'date' : undefined"
        @click="pickDay(d)"
      >
        <span class="dname" aria-hidden="true">{{ d.toLocaleDateString('fr-FR', { weekday: 'short' }) }}</span>
        <span class="dnum" aria-hidden="true">{{ d.getDate() }}</span>
        <span class="day-dot" :class="{ hidden: !stripCounts[toIso(d)] }" aria-hidden="true"></span>
      </button>
    </div>

    <p class="section-title">{{ selectedDateLabel }}</p>

    <DataState
      :loading="planning.loading"
      :error="planning.error"
      :empty="!planning.dayShifts.length"
      @retry="loadDay"
    >
      <template #empty>Aucune vacation ce jour-là.</template>

      <ion-card class="shift-card" :class="s.status" v-for="s in planning.dayShifts" :key="s.id">
        <button
          type="button"
          class="card-main"
          :aria-label="`Détail de la vacation ${timeRange(s)} à ${s.chantier_name}`"
          @click="openDetail(s)"
        >
          <ion-card-header>
            <div class="top">
              <span class="time">{{ timeRange(s) }}</span>
              <ion-badge :color="badgeColor(s.status)">{{
                s.status === 'confirmed' ? 'confirmé' : s.status === 'modified' ? 'modifié' : s.status
              }}</ion-badge>
            </div>
            <ion-card-title>{{ s.chantier_name }}</ion-card-title>
            <ion-card-subtitle><ion-icon :icon="locationOutline"></ion-icon> {{ s.chantier_address || s.chantier_name }}</ion-card-subtitle>
          </ion-card-header>
          <ion-card-content v-if="s.note">{{ s.note }}</ion-card-content>
        </button>
        <div class="card-actions">
          <ion-button fill="clear" size="small" :href="itineraryHref(s)" target="_blank" rel="noopener">
            <ion-icon slot="start" :icon="mapOutline"></ion-icon> Itinéraire
          </ion-button>
          <ion-button fill="clear" size="small" @click="exportToCalendar([s], `vacation-${s.id}.ics`)">
            <ion-icon slot="start" :icon="calendarOutline"></ion-icon> Calendrier
          </ion-button>
        </div>
      </ion-card>
    </DataState>
  </div>

  <div v-else-if="view === 'semaine'" class="week">
    <DataState
      :loading="planning.loading"
      :error="planning.error"
      :empty="false"
      @retry="loadWeek"
    >
      <ion-button
        v-if="Object.values(planning.weekShiftsByDay).flat().length"
        class="export-week-btn"
        expand="block"
        fill="outline"
        @click="exportToCalendar(Object.values(planning.weekShiftsByDay).flat(), 'planning-semaine.ics')"
      >
        <ion-icon slot="start" :icon="calendarOutline"></ion-icon> Exporter la semaine
      </ion-button>

      <ion-list v-for="d in weekDays" :key="toIso(d)" class="week-day">
        <ion-item class="week-day-item" lines="none">
          <button type="button" class="week-day-head" @click="pickDay(d)">
            {{ d.toLocaleDateString('fr-FR', { weekday: 'long', day: 'numeric', month: 'short' }) }}
          </button>
          <ion-badge slot="end" color="medium">{{ (planning.weekShiftsByDay[toIso(d)] || []).length }}</ion-badge>
        </ion-item>
        <ion-item v-for="s in planning.weekShiftsByDay[toIso(d)] || []" :key="s.id" class="week-shift" lines="none">
          <button type="button" class="ws-info" @click="openDetail(s)">
            {{ timeRange(s) }} · {{ s.chantier_name }}
            <ion-badge v-if="s.status === 'modified'" color="warning" class="ws-badge">modifié</ion-badge>
          </button>
          <ion-button
            slot="end"
            fill="clear"
            size="small"
            :href="itineraryHref(s)"
            target="_blank"
            rel="noopener"
            :aria-label="`Itinéraire vers ${s.chantier_name}`"
          >
            <ion-icon slot="icon-only" :icon="mapOutline"></ion-icon>
          </ion-button>
        </ion-item>
      </ion-list>
    </DataState>
  </div>

  <div v-else-if="view === 'mois'" class="month">
    <div class="month-nav">
      <button type="button" aria-label="Mois précédent" @click="shiftMonth(-1)"><ion-icon :icon="chevronBackOutline"></ion-icon></button>
      <strong>{{ monthLabel }}</strong>
      <button type="button" aria-label="Mois suivant" @click="shiftMonth(1)"><ion-icon :icon="chevronForwardOutline"></ion-icon></button>
    </div>
    <div class="month-weekdays" aria-hidden="true">
      <span v-for="(wd, i) in ['L', 'M', 'M', 'J', 'V', 'S', 'D']" :key="i">{{ wd }}</span>
    </div>
    <DataState
      :loading="planning.loading"
      :error="planning.error"
      :empty="false"
      :skeleton-count="2"
      @retry="loadMonth"
    >
      <div class="month-grid">
        <template v-for="(w, wi) in monthGridWeeks" :key="wi">
          <button
            v-for="d in w"
            :key="toIso(d)"
            type="button"
            class="month-cell"
            :class="{ dim: !isCurrentMonth(d), today: toIso(d) === todayIsoValue }"
            :aria-label="dayCellLabel(d)"
            @click="pickDay(d)"
          >
            <span class="mc-num">{{ d.getDate() }}</span>
            <span class="mc-dot" :class="{ hidden: !shiftsCountForDay(toIso(d)) }"></span>
          </button>
        </template>
      </div>
    </DataState>
  </div>

  <div v-else>
    <p class="section-title">{{ selectedDateLabel }} — {{ tripStops.length }} site{{ tripStops.length > 1 ? 's' : '' }}</p>

    <template v-if="tripStops.length">
      <div ref="mapEl" class="map-wrap"></div>

      <div class="map-summary-bar">
        <ion-chip class="sitem" outline><ion-icon :icon="mapOutline"></ion-icon> {{ fmtKm(tripDistanceMeters) }}</ion-chip>
        <ion-chip class="sitem" outline><ion-icon :icon="timeOutline"></ion-icon> {{ fmtDuration(tripDurationSeconds) }} trajet</ion-chip>
        <ion-chip class="optimize-badge" color="success"><ion-icon :icon="sparklesOutline"></ion-icon> Optimisée</ion-chip>
      </div>

      <ion-button
        class="start-nav-btn"
        expand="block"
        :href="turnByTurnHref({ latitude: tripStops[0].latitude, longitude: tripStops[0].longitude, address: tripStops[0].address })"
        target="_blank"
        rel="noopener"
      >
        <ion-icon slot="start" :icon="navigateOutline"></ion-icon> Démarrer la navigation vers {{ tripStops[0].name }}
      </ion-button>

      <ion-list class="stop-list">
        <ion-item v-for="(s, i) in tripStops" :key="s.id" class="stop-row" lines="full">
          <ion-badge slot="start" class="stop-num">{{ i + 1 }}</ion-badge>
          <ion-label>
            <div class="stop-top">
              <p class="sname">{{ s.name }}</p>
              <p class="seta">{{ fmtTime(s.arrival) }} - {{ fmtTime(s.departure) }}</p>
            </div>
            <p v-if="s.address" class="saddr">{{ s.address }}</p>
          </ion-label>
        </ion-item>
      </ion-list>
    </template>

    <p v-else-if="tripLoading" class="trip-empty">Calcul de l'itinéraire optimisé…</p>
    <p v-else-if="tripError" class="trip-empty">{{ tripError }}</p>
    <p v-else-if="missingCoords.length" class="trip-empty">
      Coordonnées GPS manquantes pour {{ missingCoords.join(', ') }} — à renseigner sur la fiche
      chantier dans Odoo pour calculer la tournée.
    </p>
    <p v-else class="trip-empty">Pas assez de sites planifiés ce jour-là pour une tournée.</p>
  </div>
    </ion-content>
  </ion-page>
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

/* Carte de vacation (vue Jour) : le résumé est un vrai <button> (focusable,
   annoncé par les lecteurs d'écran), les actions Itinéraire/Calendrier
   restent en dehors pour ne pas imbriquer d'interactif dans de l'interactif
   — même principe que l'ancienne .card-main / .card-actions, hébergé
   maintenant dans un ion-card plutôt qu'une div maison. */
.shift-card {
  margin: 0 18px 10px;
  border-inline-start: 3px solid var(--border-strong);
  --background: var(--surface-1);
  box-shadow: none;
}

.shift-card.confirmed {
  border-inline-start-color: var(--accent);
}

.shift-card .card-main {
  display: block;
  width: 100%;
  text-align: left;
  background: none;
  border: none;
  padding: 0;
  color: inherit;
  font: inherit;
}

.shift-card ion-card-header {
  /* Ionic (mode iOS) inverse l'ordre visuel du header (column-reverse) pour
     mettre le sous-titre au-dessus du titre — on revient à l'ordre du DOM
     (heure/statut, puis nom, puis adresse) qui reflète l'ordre de lecture voulu. */
  flex-direction: column;
  padding-bottom: 6px;
}

.shift-card .top {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 4px;
}

.shift-card .time {
  font-size: 13px;
  font-weight: 500;
}

.shift-card ion-card-title {
  font-size: 13px;
  font-weight: 500;
}

.shift-card ion-card-subtitle {
  font-size: 12px;
  color: var(--text-secondary);
  display: flex;
  align-items: center;
  gap: 4px;
  text-transform: none;
}

.shift-card ion-card-content {
  font-size: 12px;
  color: var(--text-secondary);
  padding-top: 0;
}

.shift-card .card-actions {
  display: flex;
  gap: 4px;
  margin-top: 4px;
  padding: 8px 8px 8px;
  border-top: 0.5px solid var(--border);
}

.shift-card .card-actions ion-button {
  --color: var(--accent-text);
  font-size: 12px;
  text-transform: none;
  margin: 0;
}

.week {
  padding: 0 18px 18px;
}

.export-week-btn {
  --border-radius: 10px;
  --color: var(--accent-text);
  --border-color: var(--accent-bg);
  --background: var(--accent-bg);
  --box-shadow: none;
  font-size: 13px;
  font-weight: 500;
  text-transform: none;
  margin: 0 0 12px;
}

.week-day {
  background: var(--surface-1);
  border-radius: 12px;
  padding: 4px 0;
  margin-bottom: 10px;
}

.week-day ion-item,
.week-day-item,
.week-shift {
  --background: transparent;
  --padding-start: 14px;
  --inner-padding-end: 10px;
}

.week-day-head {
  width: 100%;
  font-size: 13px;
  font-weight: 600;
  text-transform: capitalize;
  background: none;
  border: none;
  padding: 12px 0;
  color: inherit;
  font-family: inherit;
  text-align: left;
}

.week-shift .ws-info {
  flex: 1;
  min-width: 0;
  background: none;
  border: none;
  padding: 8px 0;
  text-align: left;
  font: inherit;
  font-size: 12px;
  color: var(--text-secondary);
}

.ws-badge {
  font-size: 9px;
  margin-left: 6px;
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
  color: var(--on-solid);
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
  margin: 0 18px 14px;
  --background: var(--text-primary);
  --color: var(--on-solid);
  --border-radius: 12px;
  --box-shadow: none;
  font-size: 13px;
  font-weight: 500;
  text-transform: none;
}

.map-summary-bar {
  margin: 0 18px 14px;
  display: flex;
  align-items: center;
  gap: 8px;
}

.map-summary-bar ion-chip {
  font-size: 12px;
  color: var(--text-secondary);
  --background: var(--surface-1);
}

.map-summary-bar ion-chip ion-icon {
  font-size: 15px;
}

.stop-list {
  background: transparent;
}

.stop-row {
  --background: transparent;
  --padding-start: 18px;
  --inner-padding-end: 18px;
}

.stop-num {
  margin-inline-end: 10px;
  --background: var(--text-primary);
  color: var(--on-solid);
  font-size: 11px;
  font-weight: 500;
}

.stop-top {
  display: flex;
  justify-content: space-between;
  align-items: center;
}

.sname {
  font-size: 13px;
  font-weight: 500;
  margin: 0;
}

.seta {
  font-size: 11px;
  color: var(--text-secondary);
  margin: 0;
}

.saddr {
  font-size: 11px;
  color: var(--text-secondary);
  margin: 2px 0 0;
}
</style>
