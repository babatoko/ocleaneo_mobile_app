import { describe, expect, it, vi, beforeEach } from 'vitest';
import { createPinia, setActivePinia } from 'pinia';
import { ProviderNetworkError } from '../../providers/DataProvider';
import { todayIso, addDaysIso } from '../../utils/date';
import type { Shift } from '../../types/models';

/**
 * Deux comportements verrouillés ici :
 *
 * 1. prefetchUpcoming() rafraîchit en un seul appel un cache glissant des
 *    15 prochains jours, en tâche de fond et sans jamais faire échouer
 *    l'appelant (voir main.ts, qui l'appelle sans await).
 * 2. fetchShiftsCached() (via loadDay/loadWeek/loadMonth) retombe sur ce
 *    cache glissant quand la plage exacte demandée n'a jamais été visitée
 *    individuellement — sans ça, un jour jamais ouvert en vue Jour restait
 *    vide hors ligne même s'il était couvert par prefetchUpcoming().
 */

const store = new Map<string, string>();
vi.mock('@capacitor/preferences', () => ({
  Preferences: {
    get: async ({ key }: { key: string }) => ({ value: store.get(key) ?? null }),
    set: async ({ key, value }: { key: string; value: string }) => {
      store.set(key, value);
    },
  },
}));

const fetchShifts = vi.fn();
vi.mock('../../providers', () => ({ provider: { fetchShifts: (range: unknown) => fetchShifts(range) } }));

vi.mock('../../services/planningSync', () => ({ syncShifts: vi.fn(async () => {}) }));

const { usePlanningStore } = await import('../planning');

function shift(id: number, startAt: string): Shift {
  return {
    id,
    employee_id: 1,
    chantier_id: id,
    chantier_name: `Chantier ${id}`,
    chantier_address: '',
    start_at: startAt,
    end_at: startAt,
    status: 'confirmed',
  };
}

beforeEach(() => {
  store.clear();
  fetchShifts.mockReset();
  setActivePinia(createPinia());
});

// Un jour dans la fenêtre des 15 prochains jours (aujourd'hui inclus), et un
// autre délibérément loin en dehors — calculés depuis "aujourd'hui" plutôt
// que codés en dur, pour que ces tests restent valables quel que soit le
// jour où ils s'exécutent.
const dayInWindow = addDaysIso(todayIso(), 6);
const dayOutsideWindow = addDaysIso(todayIso(), 100);

describe('prefetchUpcoming', () => {
  it('récupère et met en cache les 15 prochains jours en un seul appel', async () => {
    fetchShifts.mockResolvedValue([shift(1, `${dayInWindow}T08:00:00.000Z`)]);
    const planning = usePlanningStore();

    await planning.prefetchUpcoming();

    expect(fetchShifts).toHaveBeenCalledTimes(1);
    const [range] = fetchShifts.mock.calls[0];
    expect(range.from).toBe(todayIso());
    expect(range.to).toBe(addDaysIso(todayIso(), 14));
    expect(store.get('ocleaneo_shifts_upcoming')).toBeTruthy();
  });

  it("n'échoue jamais, même hors ligne (appel silencieux depuis main.ts)", async () => {
    fetchShifts.mockRejectedValue(new ProviderNetworkError());
    const planning = usePlanningStore();

    await expect(planning.prefetchUpcoming()).resolves.toBeUndefined();
    expect(store.has('ocleaneo_shifts_upcoming')).toBe(false);
  });
});

describe('loadDay — repli sur le cache glissant des 15 jours', () => {
  it("retombe sur prefetchUpcoming() pour un jour jamais visité individuellement", async () => {
    fetchShifts.mockResolvedValueOnce([shift(1, `${dayInWindow}T08:00:00.000Z`)]);
    const planning = usePlanningStore();
    await planning.prefetchUpcoming();

    // Ce jour précis n'a jamais été chargé via loadDay() jusqu'ici — seule
    // la fenêtre glissante le couvre. Le prochain appel réseau échoue (hors
    // ligne) : rien dans le cache par-plage exact pour ce jour.
    fetchShifts.mockRejectedValueOnce(new ProviderNetworkError());

    await planning.loadDay(dayInWindow);

    expect(planning.error).toBe('');
    expect(planning.dayShifts).toHaveLength(1);
    expect(planning.dayShifts[0].id).toBe(1);
  });

  it("laisse remonter l'erreur hors ligne quand rien n'a jamais été mis en cache", async () => {
    fetchShifts.mockRejectedValueOnce(new ProviderNetworkError());
    const planning = usePlanningStore();

    await planning.loadDay(dayInWindow);

    expect(planning.error).toContain('Pas de connexion');
    expect(planning.dayShifts).toEqual([]);
  });

  it("ignore le cache glissant pour un jour hors de sa fenêtre", async () => {
    fetchShifts.mockResolvedValueOnce([shift(1, `${dayInWindow}T08:00:00.000Z`)]);
    const planning = usePlanningStore();
    await planning.prefetchUpcoming();

    fetchShifts.mockRejectedValueOnce(new ProviderNetworkError());

    await planning.loadDay(dayOutsideWindow);

    expect(planning.error).toContain('Pas de connexion');
    expect(planning.dayShifts).toEqual([]);
  });
});
