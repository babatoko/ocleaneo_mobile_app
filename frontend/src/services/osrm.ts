import type { Position } from '../types/models';

// Service de calcul d'itinéraire optimisé via OSRM (Open Source Routing Machine).
//
// Par défaut, pointe vers le serveur de démo public d'OSRM (router.project-osrm.org).
// Ce serveur est explicitement documenté par le projet OSRM comme non destiné à un
// usage en production (pas de garantie de disponibilité, limité en débit). Pour la
// prod, définir VITE_OSRM_URL vers une instance OSRM auto-hébergée.
const OSRM_URL = import.meta.env.VITE_OSRM_URL || 'https://router.project-osrm.org';

export interface TripPoint {
  id: number | string;
  name: string;
  latitude: number;
  longitude: number;
}

export interface TripStop extends TripPoint {
  tripIndex: number;
  legDurationSeconds: number;
  legDistanceMeters: number;
}

export interface OptimizedTrip<T extends TripPoint = TripPoint> {
  order: (T & { tripIndex: number; legDurationSeconds: number; legDistanceMeters: number })[];
  distanceMeters: number;
  durationSeconds: number;
  geometry: [number, number][];
}

interface OsrmWaypoint {
  waypoint_index: number;
}

interface OsrmLeg {
  duration: number;
  distance: number;
}

interface OsrmTrip {
  distance: number;
  duration: number;
  legs: OsrmLeg[];
  geometry: { coordinates: [number, number][] };
}

interface OsrmTripResponse {
  code: string;
  message?: string;
  trips?: OsrmTrip[];
  waypoints: OsrmWaypoint[];
}

/**
 * Calcule l'ordre optimal de visite d'un ensemble de points (TSP) et l'itinéraire
 * associé via le service /trip d'OSRM. Le premier point est fixé comme point de
 * départ (position actuelle ou premier chantier).
 */
export async function getOptimizedTrip<T extends TripPoint>(points: T[]): Promise<OptimizedTrip<T>> {
  if (points.length < 2) {
    throw new Error('Il faut au moins deux points pour calculer un itinéraire.');
  }

  const coords = points.map((p) => `${p.longitude},${p.latitude}`).join(';');
  const url = `${OSRM_URL}/trip/v1/driving/${coords}?source=first&roundtrip=false&geometries=geojson&overview=full`;

  const res = await fetch(url);
  if (!res.ok) throw new Error(`OSRM a répondu ${res.status}`);
  const data: OsrmTripResponse = await res.json();
  if (data.code !== 'Ok' || !data.trips?.length) {
    throw new Error(data.message || 'Itinéraire introuvable');
  }

  const trip = data.trips[0];

  // waypoints[] est dans l'ordre d'entrée des points et indique, pour chacun,
  // sa position dans le trajet optimisé (waypoint_index).
  const ordered = data.waypoints
    .map((wp, inputIndex) => ({ ...points[inputIndex], tripIndex: wp.waypoint_index, legDurationSeconds: 0, legDistanceMeters: 0 }))
    .sort((a, b) => a.tripIndex - b.tripIndex);

  ordered.forEach((stop, i) => {
    const leg = trip.legs[i]; // pas de leg après le dernier arrêt
    stop.legDurationSeconds = leg?.duration ?? 0;
    stop.legDistanceMeters = leg?.distance ?? 0;
  });

  return {
    order: ordered,
    distanceMeters: trip.distance,
    durationSeconds: trip.duration,
    geometry: trip.geometry.coordinates.map(([lng, lat]) => [lat, lng]),
  };
}

export function getCurrentPosition(): Promise<Position | null> {
  return new Promise((resolve) => {
    if (!navigator.geolocation) return resolve(null);
    navigator.geolocation.getCurrentPosition(
      (pos) => resolve({ latitude: pos.coords.latitude, longitude: pos.coords.longitude }),
      () => resolve(null),
      { timeout: 4000 }
    );
  });
}
