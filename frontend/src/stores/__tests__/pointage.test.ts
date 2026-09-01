import { describe, expect, it, vi, beforeEach } from 'vitest';
import { setActivePinia, createPinia } from 'pinia';

/**
 * Un départ badgé clôture désormais le workorder côté serveur (voir
 * ocleaneo#11) — /chantiers/aujourdhui ne le renvoie plus dans la liste.
 * Ce test verrouille que clockWithTag() rafraîchit bien chantiers.list après
 * un départ, pour que le chantier disparaisse de l'app plutôt que d'y rester
 * affiché comme actif jusqu'à la prochaine relance.
 *
 * navigator est stubbé sans geolocation : getPosition() (stores/pointage.ts)
 * s'en accommode déjà (repli sur null), pas besoin de simuler une vraie
 * position pour ce comportement.
 */

vi.stubGlobal('navigator', {});

vi.mock('../../providers', () => ({
  provider: {
    fetchChantiers: vi.fn(),
    createTimeEntry: vi.fn(),
    fetchShifts: vi.fn(async () => []),
    fetchTodayTimeEntries: vi.fn(async () => ({ entries: [], status: 'out' })),
    fetchTimeEntries: vi.fn(async () => []),
  },
}));

vi.mock('../../services/notifications', () => ({
  showClockedInNotification: vi.fn(async () => {}),
  clearClockedInNotification: vi.fn(async () => {}),
  scheduleDepartureReminder: vi.fn(async () => {}),
  cancelDepartureReminder: vi.fn(async () => {}),
  schedulePauseReminder: vi.fn(async () => {}),
  cancelPauseReminder: vi.fn(async () => {}),
  scheduleEndOfShiftReminder: vi.fn(async () => {}),
  cancelEndOfShiftReminder: vi.fn(async () => {}),
  cancelLateReminder: vi.fn(async () => {}),
}));

vi.mock('../../services/haptics', () => ({
  hapticSuccess: vi.fn(),
  hapticError: vi.fn(),
  hapticTap: vi.fn(),
}));

vi.mock('../../services/offlineQueue', () => ({
  enqueue: vi.fn(async () => {}),
  queueLength: vi.fn(async () => 0),
  flushQueue: vi.fn(async () => ({ flushed: 0 })),
  watchConnectivity: vi.fn(),
}));

vi.mock('../../services/errorLog', () => ({
  recordError: vi.fn(async () => {}),
}));

const { provider } = await import('../../providers');
const { usePointageStore } = await import('../pointage');
const { useChantiersStore } = await import('../chantiers');

const fetchChantiers = vi.mocked(provider.fetchChantiers);
const createTimeEntry = vi.mocked(provider.createTimeEntry);
const fetchTodayTimeEntries = vi.mocked(provider.fetchTodayTimeEntries);

const CHANTIER = {
  id: 42,
  name: 'Chantier Test',
  address: '',
  is_active: 1,
  nfc_tag_id: '04:17:79:C9:78:00:00',
};

beforeEach(() => {
  setActivePinia(createPinia());
  fetchChantiers.mockReset();
  fetchTodayTimeEntries.mockReset().mockResolvedValue({ entries: [], status: 'out' });
  createTimeEntry.mockReset().mockResolvedValue({
    id: 1,
    type: 'in',
    chantier_id: CHANTIER.id,
    recorded_at: new Date().toISOString(),
  });
});

describe('clockWithTag — rafraîchissement de la liste des chantiers', () => {
  it("ne re-fetch pas la liste sur une arrivée", async () => {
    const chantiers = useChantiersStore();
    chantiers.list = [CHANTIER];
    const pointage = usePointageStore();

    await pointage.clockWithTag('041779C9780000');

    expect(fetchChantiers).not.toHaveBeenCalled();
  });

  it("re-fetch la liste sur un départ, pour que le chantier clôturé en disparaisse", async () => {
    const chantiers = useChantiersStore();
    chantiers.list = [CHANTIER];
    const pointage = usePointageStore();
    // Une arrivée déjà enregistrée sur ce chantier : le prochain scan est un
    // départ (clockWithTag alterne in/out selon le dernier pointage connu).
    // Via fetchTodayTimeEntries, pas une affectation directe de
    // pointage.entries : clockWithTag() appelle loadSafe() avant de calculer
    // le type, qui écraserait sinon cette préparation.
    fetchTodayTimeEntries.mockResolvedValue({
      entries: [{ id: 'e1', type: 'in', chantier_id: CHANTIER.id, recorded_at: new Date().toISOString() }],
      status: 'in',
    });
    createTimeEntry.mockResolvedValue({
      id: 2,
      type: 'out',
      chantier_id: CHANTIER.id,
      recorded_at: new Date().toISOString(),
    });

    await pointage.clockWithTag('041779C9780000');

    expect(fetchChantiers).toHaveBeenCalledTimes(1);
  });
});
