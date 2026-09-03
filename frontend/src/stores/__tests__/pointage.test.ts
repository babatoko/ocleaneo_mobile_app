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
const fetchShifts = vi.mocked(provider.fetchShifts);
const fetchTimeEntries = vi.mocked(provider.fetchTimeEntries);

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
  fetchShifts.mockReset().mockResolvedValue([]);
  fetchTimeEntries.mockReset().mockResolvedValue([]);
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

describe('clockWithTag — position GPS indisponible', () => {
  it("avertit sans bloquer le pointage quand la position n'a pas pu être obtenue", async () => {
    // navigator sans geolocation (stub du fichier) : getPosition() retombe
    // toujours sur null ici, exactement le cas GPS désactivé/refusé/hors
    // service sur un vrai téléphone.
    const chantiers = useChantiersStore();
    chantiers.list = [CHANTIER];
    const pointage = usePointageStore();

    await pointage.clockWithTag('041779C9780000');

    expect(createTimeEntry).toHaveBeenCalledTimes(1);
    expect(pointage.lastMessage).toEqual({
      type: 'warn',
      text: 'Position non disponible — vérifiez que la localisation est activée. Pointage tout de même enregistré.',
    });
  });
});

// /chantiers/aujourdhui est plafonné à 50 et non filtré par date (voir
// ocleaneo_mobile_pointage/controllers/pointage.py côté backend) : une
// vacation bien planifiée aujourd'hui peut en être absente. clockWithTag()
// doit d'abord matcher contre todayShifts (/planning, correctement filtré
// par date) avant de retomber sur chantiers.list.
describe('clockWithTag — matching contre le planning du jour (ocleaneo#13)', () => {
  const SHIFT = {
    id: 99,
    employee_id: 1,
    chantier_id: 99,
    chantier_name: 'Chantier Hors Plafond',
    chantier_address: '',
    start_at: new Date().toISOString(),
    end_at: new Date(Date.now() + 3600000).toISOString(),
    status: 'confirmed' as const,
    nfc_tag_id: '04:AA:BB:CC:DD:00:00',
  };

  it("matche un badge présent dans todayShifts mais absent de chantiers.list", async () => {
    const chantiers = useChantiersStore();
    chantiers.list = [];
    fetchShifts.mockResolvedValue([SHIFT]);
    const pointage = usePointageStore();

    await pointage.clockWithTag('04AABBCCDD0000');

    expect(pointage.scanError).toBe('');
    expect(createTimeEntry).toHaveBeenCalledTimes(1);
    expect(createTimeEntry.mock.calls[0][0]).toMatchObject({ chantierId: 99, shiftId: 99 });
    // Le badge a matché via todayShifts : pas besoin d'aller chercher
    // chantiers.list en repli.
    expect(fetchChantiers).not.toHaveBeenCalled();
  });

  it("retombe sur chantiers.list quand le badge n'est dans aucune vacation du jour", async () => {
    const chantiers = useChantiersStore();
    chantiers.list = [CHANTIER];
    fetchShifts.mockResolvedValue([SHIFT]);
    const pointage = usePointageStore();

    await pointage.clockWithTag('041779C9780000');

    expect(pointage.scanError).toBe('');
    expect(createTimeEntry).toHaveBeenCalledTimes(1);
    expect(createTimeEntry.mock.calls[0][0]).toMatchObject({ chantierId: CHANTIER.id });
  });
});

describe('weekPlannedHours', () => {
  // Depuis que /planning garde les commandes clôturées au lieu de les faire
  // disparaître (voir odoo/addons/ocleaneo_mobile_api_planning), une
  // vacation TERMINÉE reste dans weekShifts et doit continuer à compter pour
  // le "prévu" de la semaine — sans quoi le total rétrécirait à mesure que
  // l'agent badge ses départs, faussant la comparaison avec les heures
  // travaillées (weekOvertimeHours). Seule une vacation ANNULÉE, qui n'a
  // jamais eu lieu, ne doit pas gonfler ce total.
  function shift(id: number, status: 'confirmed' | 'done' | 'cancelled', hours: number) {
    const start = new Date('2026-09-07T08:00:00.000Z');
    const end = new Date(start.getTime() + hours * 3600000);
    return {
      id,
      employee_id: 1,
      chantier_id: id,
      chantier_name: `Chantier ${id}`,
      chantier_address: '',
      start_at: start.toISOString(),
      end_at: end.toISOString(),
      status,
    };
  }

  it('compte les vacations confirmées et terminées, pas les annulées', async () => {
    fetchShifts.mockResolvedValue([
      shift(1, 'confirmed', 3),
      shift(2, 'done', 2),
      shift(3, 'cancelled', 4),
    ]);
    const pointage = usePointageStore();

    await pointage.loadWeekSummary();

    expect(pointage.weekPlannedHours).toBe(5);
  });
});
