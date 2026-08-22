// Service de calcul d'itinéraire optimisé via OSRM (Open Source Routing Machine).
//
// Par défaut, pointe vers le serveur de démo public d'OSRM (router.project-osrm.org).
// Ce serveur est explicitement documenté par le projet OSRM comme non destiné à un
// usage en production (pas de garantie de disponibilité, limité en débit). Pour la
// prod, définir VITE_OSRM_URL vers une instance OSRM auto-hébergée.
const OSRM_URL = import.meta.env.VITE_OSRM_URL || 'https://router.project-osrm.org';

/**
 * Calcule l'ordre optimal de visite d'un ensemble de points (TSP) et l'itinéraire
 * associé via le service /trip d'OSRM.
 *
 * @param {{ id: number|string, name: string, latitude: number, longitude: number }[]} points
 *   Le premier point est fixé comme point de départ (position actuelle ou premier chantier).
 * @returns {Promise<{
 *   order: Array<typeof points[number] & { legDurationSeconds: number, legDistanceMeters: number }>,
 *   distanceMeters: number,
 *   durationSeconds: number,
 *   geometry: [number, number][],
 * }>}
 */
export async function getOptimizedTrip(points) {
  if (points.length < 2) {
    throw new Error('Il faut au moins deux points pour calculer un itinéraire.');
  }

  const coords = points.map((p) => `${p.longitude},${p.latitude}`).join(';');
  const url = `${OSRM_URL}/trip/v1/driving/${coords}?source=first&roundtrip=false&geometries=geojson&overview=full`;

  const res = await fetch(url);
  if (!res.ok) throw new Error(`OSRM a répondu ${res.status}`);
  const data = await res.json();
  if (data.code !== 'Ok' || !data.trips?.length) {
    throw new Error(data.message || "Itinéraire introuvable");
  }

  const trip = data.trips[0];

  // waypoints[] est dans l'ordre d'entrée des points et indique, pour chacun,
  // sa position dans le trajet optimisé (waypoint_index).
  const ordered = data.waypoints
    .map((wp, inputIndex) => ({ ...points[inputIndex], tripIndex: wp.waypoint_index }))
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

export function getCurrentPosition() {
  return new Promise((resolve) => {
    if (!navigator.geolocation) return resolve(null);
    navigator.geolocation.getCurrentPosition(
      (pos) => resolve({ latitude: pos.coords.latitude, longitude: pos.coords.longitude }),
      () => resolve(null),
      { timeout: 4000 }
    );
  });
}
