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
    submitCompteRendu: vi.fn(async () => {}),
  },
}));

// Même mock que planning.test.ts : @capacitor/preferences retombe sur
// localStorage en web, absent de cet environnement de test (node, pas
// jsdom — voir le vi.stubGlobal('navigator', {}) ci-dessus).
const preferencesStore = new Map<string, string>();
vi.mock('@capacitor/preferences', () => ({
  Preferences: {
    get: async ({ key }: { key: string }) => ({ value: preferencesStore.get(key) ?? null }),
    set: async ({ key, value }: { key: string; value: string }) => {
      preferencesStore.set(key, value);
    },
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
const { ProviderNetworkError } = await import('../../providers/DataProvider');
const { usePointageStore } = await import('../pointage');
const { useChantiersStore } = await import('../chantiers');
const { usePlanningStore } = await import('../planning');
const { enqueue, flushQueue } = await import('../../services/offlineQueue');

const fetchChantiers = vi.mocked(provider.fetchChantiers);
const createTimeEntry = vi.mocked(provider.createTimeEntry);
const createTimeEntryWithTag = vi.mocked(provider.createTimeEntryWithTag);
const fetchTodayTimeEntries = vi.mocked(provider.fetchTodayTimeEntries);
const fetchShifts = vi.mocked(provider.fetchShifts);
const fetchTimeEntries = vi.mocked(provider.fetchTimeEntries);
const submitCompteRendu = vi.mocked(provider.submitCompteRendu);

const CHANTIER = {
  id: 42,
  name: 'Chantier Test',
  address: '',
  is_active: 1,
  nfc_tag_id: '04:17:79:C9:78:00:00',
};

beforeEach(() => {
  setActivePinia(createPinia());
  vi.mocked(enqueue).mockClear();
  vi.mocked(flushQueue).mockReset().mockResolvedValue({ flushed: 0 } as { flushed: number; remaining: number });
  preferencesStore.clear();
  submitCompteRendu.mockReset().mockResolvedValue(undefined);
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
      text: 'Arrivé au chantier Chantier Test. Position non disponible — vérifiez que la localisation est activée.',
    });
  });
});

describe('clockWithTag — confirmation nommant le chantier', () => {
  // navigator est stubbé sans geolocation pour tout ce fichier (voir en tête) :
  // getPosition() renvoie donc toujours null ici, d'où la branche "warn" —
  // la confirmation nommant le chantier reste attendue en préfixe dans les
  // deux cas, c'est ce que ce test verrouille.
  it("préfixe l'avertissement GPS par \"Arrivé au chantier X\" sur une arrivée", async () => {
    const chantiers = useChantiersStore();
    chantiers.list = [CHANTIER];
    const pointage = usePointageStore();

    await pointage.clockWithTag('041779C9780000');

    expect(pointage.lastMessage?.text).toMatch(/^Arrivé au chantier Chantier Test\./);
  });

  it("préfixe l'avertissement GPS par \"Départ du chantier X\" sur un départ", async () => {
    const chantiers = useChantiersStore();
    chantiers.list = [CHANTIER];
    const pointage = usePointageStore();
    createTimeEntryWithTag.mockImplementation((_payload: { type: string; uid: string }) =>
      Promise.resolve({
        id: 2,
        type: 'out' as TimeEntryType,
        chantier_id: CHANTIER.id,
        shift_id: undefined as number | undefined,
        recorded_at: new Date().toISOString(),
      }),
    );

    await pointage.clockWithTag('041779C9780000');

    expect(pointage.lastMessage?.text).toMatch(/^Départ du chantier Chantier Test\./);
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

describe('commentaire — conservé même quand le badge NFC part en file hors ligne', () => {
  // Régression : la mise en file de clockWithTag() reconstruisait son propre
  // objet de payload au lieu de réutiliser celui envoyé à
  // createTimeEntryWithTag(), et oubliait le commentaire au passage — perdu
  // sans jamais remonter d'erreur, silencieusement, pour tout badge NFC posé
  // hors ligne.
  it('inclut pendingComment dans le payload mis en file, puis le vide', async () => {
    const chantiers = useChantiersStore();
    chantiers.list = [CHANTIER];
    const pointage = usePointageStore();
    pointage.pendingComment = 'EI';
    createTimeEntryWithTag.mockRejectedValueOnce(new ProviderNetworkError());

    await pointage.clockWithTag('041779C9780000');

    expect(enqueue).toHaveBeenCalledTimes(1);
    expect(vi.mocked(enqueue).mock.calls[0][0]).toMatchObject({ comment: 'EI' });
    expect(pointage.pendingComment).toBe('');
  });

  it('même chose pour postEntry() (badge indisponible / saisie manuelle)', async () => {
    const pointage = usePointageStore();
    pointage.pendingComment = 'Client absent';
    createTimeEntry.mockRejectedValueOnce(new ProviderNetworkError());

    await pointage.postEntry('in', { chantierId: CHANTIER.id });

    expect(enqueue).toHaveBeenCalledTimes(1);
    expect(vi.mocked(enqueue).mock.calls[0][0]).toMatchObject({ comment: 'Client absent' });
    expect(pointage.pendingComment).toBe('');
  });
});

describe('pendingCompteRendus — un départ résolu ouvre un compte-rendu à valider', () => {
  const SHIFT_WITH_ACTIVITIES = {
    id: 7,
    employee_id: 1,
    chantier_id: CHANTIER.id,
    chantier_name: 'Chantier Test',
    chantier_address: '',
    start_at: new Date().toISOString(),
    end_at: new Date(Date.now() + 3600000).toISOString(),
    status: 'confirmed' as const,
    activities: [
      { id: 1, name: 'Nettoyage des sanitaires', required: true, completed: false },
      { id: 2, name: 'Dépoussiérage bureaux', required: false, completed: false },
    ],
  };

  it("un départ réussi (résolu 'out' par le serveur) ajoute une entrée avec le chantier et ses activités", async () => {
    const chantiers = useChantiersStore();
    chantiers.list = [CHANTIER];
    const pointage = usePointageStore();
    // clockWithTag() rafraîchit todayShifts (loadSafe -> fetchShifts) avant
    // de résoudre les activités du départ : le mock doit donc porter sur
    // fetchShifts, pas sur un set direct de pointage.todayShifts (écrasé
    // entre-temps).
    fetchShifts.mockResolvedValueOnce([SHIFT_WITH_ACTIVITIES]);
    createTimeEntryWithTag.mockResolvedValueOnce({
      id: 9,
      type: 'out' as TimeEntryType,
      chantier_id: CHANTIER.id,
      shift_id: SHIFT_WITH_ACTIVITIES.id,
      recorded_at: new Date().toISOString(),
      client_ref: 'cr-depart-1',
    });

    await pointage.clockWithTag('041779C9780000');

    expect(pointage.pendingCompteRendus).toHaveLength(1);
    expect(pointage.pendingCompteRendus[0]).toMatchObject({
      clientRef: 'cr-depart-1',
      chantierName: 'Chantier Test',
      activities: SHIFT_WITH_ACTIVITIES.activities,
    });
  });

  it("une arrivée (résolue 'in') n'ajoute rien", async () => {
    const chantiers = useChantiersStore();
    chantiers.list = [CHANTIER];
    const pointage = usePointageStore();

    await pointage.clockWithTag('041779C9780000');

    expect(pointage.pendingCompteRendus).toHaveLength(0);
  });

  it("un départ mis en file hors ligne n'ajoute rien tant que la synchro n'a pas abouti, mais l'ajoute une fois rejoué avec succès", async () => {
    const pointage = usePointageStore();
    pointage.todayShifts = [SHIFT_WITH_ACTIVITIES];
    // _nextTypeForTag ne devine que 'in' aujourd'hui (voir pointage.ts) :
    // impossible de savoir avant la synchro qu'il s'agissait d'un départ.
    createTimeEntryWithTag.mockRejectedValueOnce(new ProviderNetworkError());

    await pointage.clockWithTag('041779C9780000');
    expect(pointage.pendingCompteRendus).toHaveLength(0);

    // Le rejeu (flushOfflineQueue) reçoit le type réel une fois la requête
    // effectivement passée — c'est à ce moment, et seulement à ce moment,
    // que le compte-rendu doit apparaître.
    vi.mocked(flushQueue).mockImplementationOnce(async (onEntry) => {
      onEntry?.({
        id: 9,
        type: 'out',
        chantier_id: CHANTIER.id,
        shift_id: SHIFT_WITH_ACTIVITIES.id,
        recorded_at: new Date().toISOString(),
        client_ref: 'cr-depart-2',
      });
      return { flushed: 1, remaining: 0 };
    });

    await pointage.flushOfflineQueue();

    expect(pointage.pendingCompteRendus).toHaveLength(1);
    expect(pointage.pendingCompteRendus[0].clientRef).toBe('cr-depart-2');
  });
});

describe('submitCompteRendu', () => {
  it('réussi : appelle le provider et vide pendingCompteRendus', async () => {
    const pointage = usePointageStore();
    pointage.pendingCompteRendus = [
      { clientRef: 'cr-1', chantierId: CHANTIER.id, chantierName: 'Chantier Test', activities: [], recordedAt: new Date().toISOString() },
    ];

    await pointage.submitCompteRendu('cr-1', 'RAS, tout est fait.', [{ id: 1, completed: true }]);

    expect(submitCompteRendu).toHaveBeenCalledWith({
      clientRef: 'cr-1',
      commentaire: 'RAS, tout est fait.',
      activities: [{ id: 1, completed: true }],
    });
    expect(pointage.pendingCompteRendus).toHaveLength(0);
  });

  it('échec réseau : met en file hors ligne mais vide quand même pendingCompteRendus (livraison déléguée à la file)', async () => {
    const pointage = usePointageStore();
    pointage.pendingCompteRendus = [
      { clientRef: 'cr-1', chantierId: CHANTIER.id, chantierName: 'Chantier Test', activities: [], recordedAt: new Date().toISOString() },
    ];
    submitCompteRendu.mockRejectedValueOnce(new ProviderNetworkError());

    await pointage.submitCompteRendu('cr-1', 'RAS', []);

    expect(enqueue).toHaveBeenCalledWith({ clientRef: 'cr-1', commentaire: 'RAS', activities: [] });
    expect(pointage.pendingCompteRendus).toHaveLength(0);
  });

  it('ne retire que le compte-rendu soumis, laisse les autres en attente', async () => {
    const pointage = usePointageStore();
    pointage.pendingCompteRendus = [
      { clientRef: 'cr-1', chantierId: 1, chantierName: 'A', activities: [], recordedAt: new Date().toISOString() },
      { clientRef: 'cr-2', chantierId: 2, chantierName: 'B', activities: [], recordedAt: new Date().toISOString() },
    ];

    await pointage.submitCompteRendu('cr-1', 'RAS', []);

    expect(pointage.pendingCompteRendus).toHaveLength(1);
    expect(pointage.pendingCompteRendus[0].clientRef).toBe('cr-2');
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
