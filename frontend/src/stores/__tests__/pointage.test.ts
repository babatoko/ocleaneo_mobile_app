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
  showCompteRenduReminder: vi.fn(async () => {}),
  cancelCompteRenduReminder: vi.fn(async () => {}),
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
const { ProviderError, ProviderNetworkError } = await import('../../providers/DataProvider');
const { usePointageStore } = await import('../pointage');
const { useChantiersStore } = await import('../chantiers');
const { usePlanningStore } = await import('../planning');
const { enqueue, flushQueue } = await import('../../services/offlineQueue');
const { showCompteRenduReminder, cancelCompteRenduReminder } = await import('../../services/notifications');

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

describe('clockWithTag — badge connu mais pas encore activé (403)', () => {
  // Gamma Therm, 8 sept : le tag existait dans le registre (créé une minute
  // avant le scan) mais restait en draft — /pointage/with-tag répond 403
  // "badge non actif". Avant ce correctif, ce 403 tombait dans le message
  // générique 404 « Badge non reconnu », poussant le responsable à
  // re-commissionner une pastille déjà scannée au lieu de l'activer.
  it("affiche « pas encore activé » sans mettre en file ni marquer l'arrivée", async () => {
    const pointage = usePointageStore();
    createTimeEntryWithTag.mockRejectedValueOnce(new ProviderError('badge non actif', 403));

    await pointage.clockWithTag('04AAC1C8780000');

    expect(pointage.scanError).toBe('Badge pas encore activé. Contactez votre responsable.');
    expect(enqueue).not.toHaveBeenCalled();
    expect(createTimeEntryWithTag).toHaveBeenCalledTimes(1);
  });
});

describe('_nextTypeForTag — machine à états du badge NFC', () => {
  const TAG_UID = '04A1B2C3D4E5F6';
  const FORMATTED_TAG_UID = '04:A1:B2:C3:D4:E5:F6';

  it("envoie 'in' quand aucun pointage n'existe pour ce badge", async () => {
    const chantiers = useChantiersStore();
    chantiers.list = [{ ...CHANTIER, nfc_tag_id: FORMATTED_TAG_UID }];
    const pointage = usePointageStore();

    await pointage.clockWithTag(TAG_UID);

    expect(createTimeEntryWithTag).toHaveBeenCalledWith(
      expect.objectContaining({ uid: TAG_UID, type: 'in' }),
    );
  });

  it("envoie 'out' quand le dernier pointage de ce badge est une arrivée", async () => {
    const chantiers = useChantiersStore();
    chantiers.list = [{ ...CHANTIER, nfc_tag_id: FORMATTED_TAG_UID }];
    const pointage = usePointageStore();
    pointage.entries = [
      { id: 1, type: 'in', chantier_id: CHANTIER.id, recorded_at: new Date().toISOString(), nfc_tag_id: FORMATTED_TAG_UID },
    ];
    createTimeEntryWithTag.mockResolvedValueOnce({
      id: 2,
      type: 'out' as TimeEntryType,
      chantier_id: CHANTIER.id,
      shift_id: undefined as number | undefined,
      recorded_at: new Date().toISOString(),
      nfc_tag_id: FORMATTED_TAG_UID,
    });

    await pointage.clockWithTag(TAG_UID);

    expect(createTimeEntryWithTag).toHaveBeenCalledWith(
      expect.objectContaining({ uid: TAG_UID, type: 'out' }),
    );
  });

  it("envoie 'in' après un départ sur ce badge", async () => {
    const chantiers = useChantiersStore();
    chantiers.list = [{ ...CHANTIER, nfc_tag_id: FORMATTED_TAG_UID }];
    const pointage = usePointageStore();
    pointage.entries = [
      { id: 1, type: 'in', chantier_id: CHANTIER.id, recorded_at: new Date().toISOString(), nfc_tag_id: FORMATTED_TAG_UID },
      { id: 2, type: 'out', chantier_id: CHANTIER.id, recorded_at: new Date().toISOString(), nfc_tag_id: FORMATTED_TAG_UID },
    ];

    await pointage.clockWithTag(TAG_UID);

    expect(createTimeEntryWithTag).toHaveBeenCalledWith(
      expect.objectContaining({ uid: TAG_UID, type: 'in' }),
    );
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

  it('un départ mis en file hors ligne ouvre DÈS MAINTENANT un compte-rendu provisoire (issue #117), confirmé au rejeu', async () => {
    const chantiers = useChantiersStore();
    chantiers.list = [CHANTIER];
    const pointage = usePointageStore();
    pointage.todayShifts = [SHIFT_WITH_ACTIVITIES];
    // Une arrivée est déjà connue localement : _nextTypeForTag peut donc
    // deviner 'out' pour le badge suivant (scénario réaliste : arrivée badgée
    // en ligne le matin, départ hors ligne dans un sous-sol).
    pointage.entries = [
      { id: 'e0', type: 'in', chantier_id: CHANTIER.id, recorded_at: new Date().toISOString() },
    ];
    // Le badge est rejeté réseau : il part dans la file avec le type deviné
    // ('out' ici — la dernière entrée connue du chantier est une arrivée).
    // Issue #117 : la demande de compte-rendu doit avoir lieu DANS TOUS LES
    // CAS, dès le badge — le formulaire fonctionne d'ailleurs déjà hors ligne.
    createTimeEntryWithTag.mockRejectedValueOnce(new ProviderNetworkError());

    await pointage.clockWithTag('041779C9780000');
    expect(pointage.pendingCompteRendus).toHaveLength(1);
    expect(pointage.pendingCompteRendus[0]).toMatchObject({
      chantierName: 'Chantier Test',
      provisional: true,
    });
    const provisionalRef = pointage.pendingCompteRendus[0].clientRef;
    expect(provisionalRef).toBeTruthy();

    // Le rejeu (flushOfflineQueue) reçoit le type réel une fois la requête
    // effectivement passée. Le serveur a résolu 'out' : l'entrée provisoire
    // est CONFIRMÉE (flag levé, infos complétées) — jamais de doublon.
    vi.mocked(flushQueue).mockImplementationOnce(async (onEntry) => {
      onEntry?.({
        id: 9,
        type: 'out',
        chantier_id: CHANTIER.id,
        shift_id: SHIFT_WITH_ACTIVITIES.id,
        recorded_at: new Date().toISOString(),
        client_ref: provisionalRef,
      });
      return { flushed: 1, remaining: 0 };
    });
    fetchShifts.mockResolvedValueOnce([SHIFT_WITH_ACTIVITIES]);

    await pointage.flushOfflineQueue();

    expect(pointage.pendingCompteRendus).toHaveLength(1);
    expect(pointage.pendingCompteRendus[0]).toMatchObject({
      clientRef: provisionalRef,
      chantierName: 'Chantier Test',
      provisional: false,
    });
  });

  it("le type deviné était faux (serveur résout 'in') : le CR provisoire est retiré au rejeu, pas de formulaire fantôme", async () => {
    const chantiers = useChantiersStore();
    chantiers.list = [CHANTIER];
    const pointage = usePointageStore();
    pointage.todayShifts = [SHIFT_WITH_ACTIVITIES];
    // Store vide d'entrées : _nextTypeForTag ne peut pas savoir qu'une arrivée
    // était déjà badgée plus tôt — il devine 'in'... ce test simule l'inverse
    // d'un cas réel : le client devine 'out' (dernière entrée connue = 'in')
    // mais le serveur tranche 'in' (ex. doublon déjà rejeté/résolu à l'inverse).
    pointage.entries = [
      { id: 'e1', type: 'in', chantier_id: CHANTIER.id, recorded_at: new Date().toISOString() },
    ];
    createTimeEntryWithTag.mockRejectedValueOnce(new ProviderNetworkError());

    await pointage.clockWithTag('041779C9780000');
    // 'in' deviné -> dernier pointage du chantier 'in' => type 'out' deviné.
    expect(pointage.pendingCompteRendus).toHaveLength(1);
    expect(pointage.pendingCompteRendus[0].provisional).toBe(true);
    const provisionalRef = pointage.pendingCompteRendus[0].clientRef;

    // ... mais le serveur résout finalement 'in' : le CR provisoire doit
    // disparaître, sinon l'agent se ferait réclamer un compte-rendu de départ
    // qui n'existe pas.
    vi.mocked(flushQueue).mockImplementationOnce(async (onEntry) => {
      onEntry?.({
        id: 9,
        type: 'in',
        chantier_id: CHANTIER.id,
        recorded_at: new Date().toISOString(),
        client_ref: provisionalRef,
      });
      return { flushed: 1, remaining: 0 };
    });

    await pointage.flushOfflineQueue();

    expect(pointage.pendingCompteRendus).toHaveLength(0);
  });

  it('handleTagRead redirige vers le formulaire après un départ hors ligne (comme en ligne)', async () => {
    const chantiers = useChantiersStore();
    chantiers.list = [CHANTIER];
    const pointage = usePointageStore();
    pointage.todayShifts = [SHIFT_WITH_ACTIVITIES];
    // Même scénario que le test précédent : arrivée déjà badgée, départ hors
    // ligne — le CR provisoire doit faire monter le compteur.
    pointage.entries = [
      { id: 'e0', type: 'in', chantier_id: CHANTIER.id, recorded_at: new Date().toISOString() },
    ];
    createTimeEntryWithTag.mockRejectedValueOnce(new ProviderNetworkError());

    // handleTagRead compare pendingCompteRendus avant/après clockWithTag pour
    // décider de la redirection : le CR provisoire doit donc faire monter ce
    // compteur dès le badge hors ligne.
    const pendingBefore = pointage.pendingCompteRendus.length;
    await pointage.clockWithTag('041779C9780000');
    expect(pointage.pendingCompteRendus.length).toBeGreaterThan(pendingBefore);
  });

  it('un CR rempli hors ligne part dans la file et le rappel local est annulé', async () => {
    const pointage = usePointageStore();
    pointage.pendingCompteRendus = [
      {
        clientRef: 'cr-off-1',
        chantierId: CHANTIER.id,
        chantierName: 'Chantier Test',
        activities: [],
        recordedAt: new Date().toISOString(),
        provisional: true,
      },
    ];
    submitCompteRendu.mockRejectedValueOnce(new ProviderNetworkError());

    await pointage.submitCompteRendu('cr-off-1', 'Tout va bien');

    expect(enqueue).toHaveBeenCalledWith(
      expect.objectContaining({ clientRef: 'cr-off-1', commentaire: 'Tout va bien' }),
    );
    expect(pointage.pendingCompteRendus).toHaveLength(0);
    expect(cancelCompteRenduReminder).toHaveBeenCalledTimes(1);
  });

  it('la notification de rappel est émise à la création du CR en attente', async () => {
    const chantiers = useChantiersStore();
    chantiers.list = [CHANTIER];
    const pointage = usePointageStore();
    pointage.todayShifts = [SHIFT_WITH_ACTIVITIES];
    createTimeEntryWithTag.mockRejectedValueOnce(new ProviderNetworkError());

    await pointage.clockWithTag('041779C9780000');

    expect(showCompteRenduReminder).toHaveBeenCalledWith('Chantier Test');
  });

  it("le type deviné 'in' (aucun historique local) n'inscrit pas de CR provisoire : le flush tranchera", async () => {
    // Cas limite assumé (issue #117) : après un redémarrage, aucune entrée
    // locale ne permet de deviner 'out' — le badge part en file en 'in', sans
    // CR provisoire. Le rejeu tranchera avec le type serveur (flux existant).
    const pointage = usePointageStore();
    pointage.todayShifts = [SHIFT_WITH_ACTIVITIES];
    createTimeEntryWithTag.mockRejectedValueOnce(new ProviderNetworkError());

    await pointage.clockWithTag('041779C9780000');

    expect(pointage.pendingCompteRendus).toHaveLength(0);
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
