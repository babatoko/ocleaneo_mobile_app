import type { TimeEntryType } from '../../types/models';
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
    createTimeEntryWithTag: vi.fn(),
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
const { usePlanningStore } = await import('../planning');

const fetchChantiers = vi.mocked(provider.fetchChantiers);
const createTimeEntry = vi.mocked(provider.createTimeEntry);
const createTimeEntryWithTag = vi.mocked(provider.createTimeEntryWithTag);
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
  createTimeEntryWithTag.mockReset().mockImplementation((_payload: { type: string; uid: string }) =>
    Promise.resolve({
      id: 1,
      type: 'in' as TimeEntryType,
      chantier_id: CHANTIER.id,
      shift_id: undefined as number | undefined,
      recorded_at: new Date().toISOString(),
    }),
  );
});

describe('clockWithTag — rafraîchissement de la liste des chantiers', () => {
  it("ne re-fetch pas la liste sur une arrivée", async () => {
    const chantiers = useChantiersStore();
    chantiers.list = [CHANTIER];
    const pointage = usePointageStore();

    await pointage.clockWithTag('041779C9780000');

    expect(fetchChantiers).not.toHaveBeenCalled();
  });

  it("re-fetch la liste sur un départ retourné par le backend", async () => {
    const chantiers = useChantiersStore();
    chantiers.list = [CHANTIER];
    const pointage = usePointageStore();
    createTimeEntryWithTag.mockImplementation((_payload: { type: string; uid: string }) =>
      Promise.resolve({
        id: 2,
        type: 'out',
        chantier_id: CHANTIER.id,
        shift_id: undefined as number | undefined,
        recorded_at: new Date().toISOString(),
      }),
    );

    await pointage.clockWithTag('041779C9780000');

    expect(fetchChantiers).toHaveBeenCalledTimes(1);
  });

  it("marque la vacation \"done\" côté planning sur un départ retourné par le backend", async () => {
    const chantiers = useChantiersStore();
    chantiers.list = [CHANTIER];
    const pointage = usePointageStore();
    const planning = usePlanningStore();
    const markShiftDone = vi.spyOn(planning, 'markShiftDone').mockResolvedValue();
    createTimeEntryWithTag.mockImplementation((_payload: { type: string; uid: string }) =>
      Promise.resolve({
        id: 2,
        type: 'out',
        chantier_id: CHANTIER.id,
        shift_id: undefined as number | undefined,
        recorded_at: new Date().toISOString(),
      }),
    );

    await pointage.clockWithTag('041779C9780000');

    expect(markShiftDone).toHaveBeenCalledWith(CHANTIER.id);
  });

  it('répercute le vrai statut de complétion renvoyé par le serveur (chantier fait partiellement)', async () => {
    // Un départ sous 90% du temps prévu ne clôture plus le chantier — voir
    // fsm_order.update_completion_from_worked_time côté Odoo. Le statut réel
    // (ici 'partial') doit être transmis à markShiftDone(), pas le défaut
    // 'done' qui supposerait à tort une vacation entièrement effectuée.
    const chantiers = useChantiersStore();
    chantiers.list = [CHANTIER];
    const pointage = usePointageStore();
    const planning = usePlanningStore();
    const markShiftDone = vi.spyOn(planning, 'markShiftDone').mockResolvedValue();
    fetchTodayTimeEntries.mockResolvedValue({
      entries: [{ id: 'e1', type: 'in', chantier_id: CHANTIER.id, recorded_at: new Date().toISOString() }],
      status: 'in',
    });
    createTimeEntryWithTag.mockImplementation((_payload: { type: string; uid: string }) =>
      Promise.resolve({
        id: 2,
        type: 'out' as TimeEntryType,
        chantier_id: CHANTIER.id,
        shift_id: undefined as number | undefined,
        recorded_at: new Date().toISOString(),
        shift_status: 'partial' as const,
        completion_ratio: 0.5,
      }),
    );

    await pointage.clockWithTag('041779C9780000');

    expect(markShiftDone).toHaveBeenCalledWith(CHANTIER.id, 'partial');
  });
});

describe('clockWithTag — position GPS indisponible', () => {
  it("avertit sans bloquer le pointage quand la position n'a pas pu être obtenue", async () => {
    const chantiers = useChantiersStore();
    chantiers.list = [CHANTIER];
    const pointage = usePointageStore();

    await pointage.clockWithTag('041779C9780000');

    expect(createTimeEntryWithTag).toHaveBeenCalledTimes(1);
    expect(pointage.lastMessage).toEqual({
      type: 'warn',
      text: 'Position non disponible — vérifiez que la localisation est activée. Pointage tout de même enregistré.',
    });
  });
});

describe('clockWithTag — matching contre le backend NFC (ocleaneo#13 / pointage with-tag)', () => {
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

  it("envoie un pointage avec le tag scanné, indépendamment du planning", async () => {
    const chantiers = useChantiersStore();
    chantiers.list = [];
    fetchShifts.mockResolvedValue([SHIFT]);
    const pointage = usePointageStore();

    await pointage.clockWithTag('04AABBCCDD0000');

    expect(pointage.scanError).toBe('');
    expect(createTimeEntryWithTag).toHaveBeenCalledTimes(1);
    expect(createTimeEntryWithTag.mock.calls[0][0]).toMatchObject({ uid: '04AABBCCDD0000', type: 'in' });
  });

  it("envoie toujours 'in' au backend — l'alternance départ/arrivée est résolue côté serveur", async () => {
    const chantiers = useChantiersStore();
    chantiers.list = [CHANTIER];
    fetchShifts.mockResolvedValue([SHIFT]);
    fetchTodayTimeEntries.mockResolvedValue({
      entries: [{ id: 'e1', type: 'in', chantier_id: CHANTIER.id, recorded_at: new Date().toISOString() }],
      status: 'in',
    });
    const pointage = usePointageStore();

    await pointage.clockWithTag('04AABBCCDD0000');

    expect(createTimeEntryWithTag.mock.calls[0][0]).toMatchObject({ uid: '04AABBCCDD0000', type: 'in' });
  });
});

describe('weekPlannedHours', () => {
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
