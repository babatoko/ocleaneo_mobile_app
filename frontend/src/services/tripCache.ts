import { Preferences } from '@capacitor/preferences';
import type { OptimizedTrip, TripPoint } from './osrm';

/**
 * Dernier itinéraire optimisé connu pour un jour donné, mis en cache pour
 * que la Tournée reste consultable hors ligne — jusqu'ici, une coupure
 * réseau faisait totalement échouer l'optimisation (getOptimizedTrip()
 * appelle un service externe, OSRM) sans aucun repli, contrairement au
 * planning lui-même (stores/planning.ts, fetchShiftsCached()).
 *
 * Le calcul d'un nouvel itinéraire reste impossible hors ligne (OSRM est un
 * service distant) : ce cache ne fait que réafficher le dernier trajet
 * calculé pour le même jour, tant que l'ensemble des chantiers du jour n'a
 * pas changé depuis (voir signature()) — jamais un ordre de passage qui ne
 * correspondrait plus au planning réel.
 */

const CACHE_KEY_PREFIX = 'ocleaneo_trip_';

/** Uniquement les chantiers (jamais le point "position actuelle", qui n'a
 *  pas d'identité stable) — triés pour être indépendants de l'ordre
 *  d'entrée. */
function signature(points: TripPoint[]): string {
  return points
    .filter((p) => p.id !== 'me')
    .map((p) => String(p.id))
    .sort()
    .join(',');
}

function cacheKey(dateIso: string, points: TripPoint[]): string {
  return `${CACHE_KEY_PREFIX}${dateIso}_${signature(points)}`;
}

export async function cacheTrip<T extends TripPoint>(
  dateIso: string,
  points: T[],
  trip: OptimizedTrip<T>,
): Promise<void> {
  await Preferences.set({ key: cacheKey(dateIso, points), value: JSON.stringify(trip) }).catch(() => {});
}

export async function readCachedTrip<T extends TripPoint>(
  dateIso: string,
  points: T[],
): Promise<OptimizedTrip<T> | null> {
  const { value } = await Preferences.get({ key: cacheKey(dateIso, points) }).catch(() => ({ value: null }));
  return value ? JSON.parse(value) : null;
}
