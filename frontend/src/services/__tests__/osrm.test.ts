import { describe, expect, it, vi, afterEach } from 'vitest';
import { ProviderNetworkError } from '../../providers/DataProvider';
import { getOptimizedTrip } from '../osrm';

/**
 * Hors ligne, fetch() rejette avec un message technique brut (« Failed to
 * fetch »), indistinct d'une vraie panne serveur — avant ce correctif, il
 * remontait tel quel jusqu'à l'écran Tournée (PlanningView.vue), qui n'avait
 * en plus aucun repli (contrairement au planning lui-même,
 * stores/planning.ts). getOptimizedTrip() doit lever une ProviderNetworkError
 * reconnaissable, pour que l'appelant puisse retomber sur le dernier
 * itinéraire mis en cache (services/tripCache.ts).
 */

const points = [
  { id: 1, name: 'A', latitude: 45.0, longitude: 4.8 },
  { id: 2, name: 'B', latitude: 45.1, longitude: 4.9 },
];

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('getOptimizedTrip', () => {
  it('lève une ProviderNetworkError reconnaissable quand fetch échoue (hors ligne)', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new TypeError('Failed to fetch')));

    const err = await getOptimizedTrip(points).catch((e) => e);

    expect(err).toBeInstanceOf(ProviderNetworkError);
    expect(err.message).not.toMatch(/failed to fetch/i);
  });

  it('exige au moins deux points', async () => {
    await expect(getOptimizedTrip([points[0]])).rejects.toThrow('au moins deux points');
  });

  it('laisse remonter un vrai échec serveur (HTTP non-ok)', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: false, status: 500 }));

    await expect(getOptimizedTrip(points)).rejects.toThrow('OSRM a répondu 500');
  });

  it("calcule l'ordre optimisé à partir d'une réponse OSRM valide", async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({
          code: 'Ok',
          trips: [
            {
              distance: 1000,
              duration: 120,
              legs: [{ duration: 60, distance: 500 }, { duration: 60, distance: 500 }],
              geometry: { coordinates: [[4.8, 45.0], [4.9, 45.1]] },
            },
          ],
          waypoints: [{ waypoint_index: 0 }, { waypoint_index: 1 }],
        }),
      }),
    );

    const trip = await getOptimizedTrip(points);

    expect(trip.order.map((p) => p.id)).toEqual([1, 2]);
    expect(trip.distanceMeters).toBe(1000);
  });
});
