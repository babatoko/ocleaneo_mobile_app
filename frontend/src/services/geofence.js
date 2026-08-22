const EARTH_RADIUS_M = 6371000;

function toRad(deg) {
  return (deg * Math.PI) / 180;
}

/** Distance à vol d'oiseau entre deux points GPS, en mètres (formule de Haversine). */
export function distanceMeters(a, b) {
  const dLat = toRad(b.latitude - a.latitude);
  const dLon = toRad(b.longitude - a.longitude);
  const lat1 = toRad(a.latitude);
  const lat2 = toRad(b.latitude);
  const h =
    Math.sin(dLat / 2) ** 2 + Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLon / 2) ** 2;
  return 2 * EARTH_RADIUS_M * Math.asin(Math.min(1, Math.sqrt(h)));
}

// Tolérance large : précision GPS en intérieur/sous-sol, parking du site, etc.
// Un dépassement ne bloque jamais le pointage — il est seulement signalé pour
// que Odoo puisse le passer en revue (anti-fraude sans pénaliser le terrain).
export const GEOFENCE_TOLERANCE_M = 150;

/**
 * Renvoie null si la position ou les coordonnées du chantier sont inconnues
 * (rien à vérifier), sinon { withinRange, distanceMeters }.
 */
export function checkGeofence(position, chantier) {
  if (!position || !chantier?.latitude || !chantier?.longitude) return null;
  const d = distanceMeters(position, { latitude: chantier.latitude, longitude: chantier.longitude });
  return { withinRange: d <= GEOFENCE_TOLERANCE_M, distanceMeters: Math.round(d) };
}
