import { describe, expect, it, vi, beforeEach } from 'vitest';
import type { OptimizedTrip, TripPoint } from '../osrm';

const store = new Map<string, string>();
vi.mock('@capacitor/preferences', () => ({
  Preferences: {
    get: async ({ key }: { key: string }) => ({ value: store.get(key) ?? null }),
    set: async ({ key, value }: { key: string; value: string }) => {
      store.set(key, value);
    },
  },
}));

const { cacheTrip, readCachedTrip } = await import('../tripCache');

const points: TripPoint[] = [
  { id: 3, name: 'Chantier B', latitude: 45.1, longitude: 4.9 },
  { id: 1, name: 'Chantier A', latitude: 45.0, longitude: 4.8 },
];

function trip(): OptimizedTrip<TripPoint> {
  return {
    order: points.map((p, i) => ({ ...p, tripIndex: i, legDurationSeconds: 60, legDistanceMeters: 500 })),
    distanceMeters: 1000,
    durationSeconds: 120,
    geometry: [[45.0, 4.8], [45.1, 4.9]],
  };
}

beforeEach(() => {
  store.clear();
});

describe('tripCache', () => {
  it('relit exactement le trajet mis en cache pour le même jour et le même jeu de chantiers', async () => {
    await cacheTrip('2026-09-10', points, trip());

    const cached = await readCachedTrip('2026-09-10', points);

    expect(cached).toEqual(trip());
  });

  it("ignore l'ordre d'entrée des points (signature triée)", async () => {
    await cacheTrip('2026-09-10', points, trip());

    const cached = await readCachedTrip('2026-09-10', [...points].reverse());

    expect(cached).toEqual(trip());
  });

  it("ne renvoie rien pour un autre jour", async () => {
    await cacheTrip('2026-09-10', points, trip());

    expect(await readCachedTrip('2026-09-11', points)).toBeNull();
  });

  it("ne renvoie rien si le jeu de chantiers a changé (une vacation ajoutée/annulée)", async () => {
    await cacheTrip('2026-09-10', points, trip());

    const changed = [...points, { id: 4, name: 'Chantier C', latitude: 45.2, longitude: 5.0 }];
    expect(await readCachedTrip('2026-09-10', changed)).toBeNull();
  });

  it("ignore le point 'position actuelle' dans la signature", async () => {
    await cacheTrip('2026-09-10', points, trip());

    const withCurrent = [{ id: 'me', name: 'Position actuelle', latitude: 45.05, longitude: 4.85 }, ...points];
    const cached = await readCachedTrip('2026-09-10', withCurrent);

    expect(cached).toEqual(trip());
  });

  it('renvoie null quand rien n’a jamais été mis en cache', async () => {
    expect(await readCachedTrip('2026-09-10', points)).toBeNull();
  });
});
