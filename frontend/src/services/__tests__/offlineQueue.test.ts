import { describe, expect, it, vi, beforeEach } from 'vitest';

/**
 * La file hors ligne est le seul endroit qui garantisse qu'un pointage
 * enregistré sans réseau finira par arriver. Un défaut ici ne se voit pas à
 * l'écran — l'app affiche « pointage enregistré » dans tous les cas — et se
 * paie en heures non comptées. Elle n'avait pourtant aucun test, et c'est
 * ainsi qu'une perte de pointage sous concurrence a pu y vivre.
 *
 * Ces tests s'exécutent sur un stockage simulé volontairement asynchrone :
 * lire puis écrire n'est pas atomique, et c'est précisément ce que le vrai
 * @capacitor/preferences fait aussi. Un mock synchrone ne prouverait rien.
 */

let store: Record<string, string> = {};
const tick = () => new Promise((r) => setTimeout(r, 0));

vi.mock('@capacitor/preferences', () => ({
  Preferences: {
    get: async ({ key }: { key: string }) => {
      await tick();
      return { value: store[key] ?? null };
    },
    set: async ({ key, value }: { key: string; value: string }) => {
      await tick();
      store[key] = value;
    },
    remove: async ({ key }: { key: string }) => {
      await tick();
      delete store[key];
    },
  },
}));

const netListeners: Array<(s: { connected: boolean }) => void> = [];
const appListeners: Array<() => void> = [];
vi.mock('@capacitor/network', () => ({
  Network: {
    addListener: (_e: string, cb: (s: { connected: boolean }) => void) => {
      netListeners.push(cb);
    },
  },
}));
vi.mock('@capacitor/app', () => ({
  App: {
    addListener: (_e: string, cb: () => void) => {
      appListeners.push(cb);
    },
  },
}));

const createTimeEntry = vi.fn();
vi.mock('../../providers', () => ({
  provider: { createTimeEntry: (...a: unknown[]) => createTimeEntry(...a) },
}));

const { ProviderNetworkError } = await import('../../providers/DataProvider');
const {
  enqueue,
  flushQueue,
  queueLength,
  watchConnectivity,
  failedEntries,
  failedCount,
  clearFailedEntries,
} = await import('../offlineQueue');

/** Latence réseau réaliste : un POST est bien plus lent qu'une écriture de
 *  stockage local. C'est cet ordonnancement qui révèle la course — avec un
 *  envoi instantané, le défaut se déguise en simple doublon bénin. */
const slowOk = () => new Promise((r) => setTimeout(() => r({ id: 1 }), 30));

function entry(clientRef: string, type = 'in') {
  return { type, chantierId: 1, recordedAt: `T-${clientRef}`, clientRef } as never;
}
const sentRefs = () =>
  createTimeEntry.mock.calls.map((c) => (c[0] as { clientRef: string }).clientRef);

beforeEach(() => {
  store = {};
  createTimeEntry.mockReset();
  createTimeEntry.mockImplementation(slowOk);
  netListeners.length = 0;
  appListeners.length = 0;
});

describe('file hors ligne — intégrité sous concurrence', () => {
  it("ne perd pas un pointage mis en file pendant un rejeu", async () => {
    // Le scénario réel : la file contient un pointage, le réseau revient, et
    // le salarié badge son départ au même instant.
    await enqueue(entry('A'));

    const flushing = flushQueue();
    const queueing = enqueue(entry('B', 'out'));
    await Promise.all([flushing, queueing]);

    // B doit avoir survécu : soit parti, soit encore en file pour le prochain
    // rejeu. Ce qu'il ne doit jamais être, c'est ni l'un ni l'autre.
    const survived = sentRefs().includes('B') || (await queueLength()) > 0;
    expect(survived).toBe(true);
  });

  it('finit par tout envoyer, une seule fois chacun', async () => {
    await enqueue(entry('A'));
    await Promise.all([flushQueue(), enqueue(entry('B', 'out'))]);
    await flushQueue();

    expect(sentRefs().sort()).toEqual(['A', 'B']);
    expect(await queueLength()).toBe(0);
  });

  it("n'envoie pas deux fois quand deux rejeux démarrent ensemble", async () => {
    // watchConnectivity pose deux déclencheurs qui se produisent volontiers
    // ensemble : retour du réseau ET retour au premier plan.
    await enqueue(entry('A'));
    await enqueue(entry('B', 'out'));

    await Promise.all([flushQueue(), flushQueue()]);

    expect(sentRefs()).toEqual(['A', 'B']);
    expect(await queueLength()).toBe(0);
  });

  it('ne perd rien quand plusieurs pointages sont mis en file en parallèle', async () => {
    await Promise.all([enqueue(entry('A')), enqueue(entry('B')), enqueue(entry('C'))]);
    expect(await queueLength()).toBe(3);
  });
});

describe('file hors ligne — ordre et reprise', () => {
  it("préserve l'ordre, dont dépend l'alternance arrivée/départ", async () => {
    await enqueue(entry('A', 'in'));
    await enqueue(entry('B', 'out'));
    await enqueue(entry('C', 'in'));

    await flushQueue();

    expect(sentRefs()).toEqual(['A', 'B', 'C']);
  });

  it('garde les entrées restantes quand le réseau retombe en cours de rejeu', async () => {
    await enqueue(entry('A'));
    await enqueue(entry('B'));
    await enqueue(entry('C'));

    createTimeEntry
      .mockImplementationOnce(slowOk)
      .mockImplementationOnce(() => Promise.reject(new ProviderNetworkError()));

    const { flushed, remaining } = await flushQueue();

    expect(flushed).toBe(1);
    expect(remaining).toBe(2);
    // B n'est pas consommé : il repassera en tête au prochain rejeu.
    createTimeEntry.mockImplementation(slowOk);
    await flushQueue();
    expect(sentRefs()).toEqual(['A', 'B', 'B', 'C']);
  });

  it('ne bloque pas la file derrière une entrée refusée par le serveur', async () => {
    await enqueue(entry('A'));
    await enqueue(entry('B'));

    // Erreur métier, pas réseau : l'entrée sort de la file, sinon elle
    // échouerait à chaque tentative et bloquerait les suivantes.
    createTimeEntry.mockImplementationOnce(() => Promise.reject(new Error('400 refusé')));

    const { remaining } = await flushQueue();

    expect(sentRefs()).toEqual(['A', 'B']);
    expect(remaining).toBe(0);
  });
});

describe('file hors ligne — un refus ne détruit pas le pointage', () => {
  it('met de côté le pointage refusé au lieu de l’effacer', async () => {
    await enqueue(entry('A'));
    createTimeEntry.mockImplementationOnce(() => Promise.reject(new Error('400 refusé')));

    await flushQueue();

    // Le pointage a quitté la file, mais il existe encore : effacer du temps
    // de travail sans trace n'est pas acceptable.
    expect(await queueLength()).toBe(0);
    const failed = await failedEntries();
    expect(failed).toHaveLength(1);
    expect(failed[0].clientRef).toBe('A');
  });

  it('conserve le motif du refus et la date, pour pouvoir le reprendre', async () => {
    await enqueue(entry('A'));
    createTimeEntry.mockImplementationOnce(() =>
      Promise.reject(new Error('chantier non assigné')),
    );

    await flushQueue();

    const [failed] = await failedEntries();
    expect(failed.reason).toBe('chantier non assigné');
    expect(Date.parse(failed.failedAt)).not.toBeNaN();
  });

  it("ne compte pas un refus réseau comme un refus définitif", async () => {
    await enqueue(entry('A'));
    createTimeEntry.mockImplementationOnce(() => Promise.reject(new ProviderNetworkError()));

    await flushQueue();

    // Une coupure n'est pas un refus : le pointage reste en file pour la
    // prochaine tentative, et rien ne part de côté.
    expect(await queueLength()).toBe(1);
    expect(await failedCount()).toBe(0);
  });

  it('peut être vidé une fois les refus traités', async () => {
    await enqueue(entry('A'));
    createTimeEntry.mockImplementationOnce(() => Promise.reject(new Error('400')));
    await flushQueue();
    expect(await failedCount()).toBe(1);

    await clearFailedEntries();

    expect(await failedCount()).toBe(0);
  });

  it('ne rejoue pas indéfiniment une file vide', async () => {
    const { flushed, remaining } = await flushQueue();
    expect(flushed).toBe(0);
    expect(remaining).toBe(0);
    expect(createTimeEntry).not.toHaveBeenCalled();
  });
});

describe('file hors ligne — déclencheurs de reconnexion', () => {
  it('rejoue au retour du réseau et au retour au premier plan', () => {
    const onReconnect = vi.fn();
    watchConnectivity(onReconnect);

    netListeners.forEach((cb) => cb({ connected: true }));
    appListeners.forEach((cb) => cb());

    expect(onReconnect).toHaveBeenCalled();
  });

  it('ignore un évènement réseau signalant une coupure', () => {
    const onReconnect = vi.fn();
    watchConnectivity(onReconnect);
    onReconnect.mockClear();

    netListeners.forEach((cb) => cb({ connected: false }));

    expect(onReconnect).not.toHaveBeenCalled();
  });
});
