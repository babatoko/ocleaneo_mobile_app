import { describe, expect, it, vi, beforeEach } from 'vitest';

/**
 * Le journal d'erreurs est le filet qui rend un plantage observable. S'il
 * échoue lui-même — stockage plein, valeur corrompue — il doit se taire et
 * laisser l'app fonctionner : une erreur de journalisation qui remonte
 * masquerait précisément celle qu'on cherchait à consigner.
 */

let store: Record<string, string> = {};
let failNextSet = false;

vi.mock('@capacitor/preferences', () => ({
  Preferences: {
    get: async ({ key }: { key: string }) => ({ value: store[key] ?? null }),
    set: async ({ key, value }: { key: string; value: string }) => {
      if (failNextSet) {
        failNextSet = false;
        throw new Error('stockage plein');
      }
      store[key] = value;
    },
    remove: async ({ key }: { key: string }) => {
      delete store[key];
    },
  },
}));

const { recordError, recentErrors, errorCount, clearErrorLog, formatErrorLog, installErrorHandlers } =
  await import('../errorLog');

beforeEach(() => {
  store = {};
  failNextSet = false;
});

describe('journal d’erreurs', () => {
  it("consigne le message et la pile d'une Error", async () => {
    await recordError(new Error('badge illisible'), 'nfc');

    const [entry] = await recentErrors();
    expect(entry.message).toBe('badge illisible');
    expect(entry.context).toBe('nfc');
    expect(entry.stack).toBeTruthy();
    expect(Date.parse(entry.at)).not.toBeNaN();
  });

  it('accepte ce qui n’est pas une Error', async () => {
    // Une promesse rejetée peut l'être avec n'importe quoi.
    await recordError('panne texte', 'promesse');
    await recordError({ code: 42 }, 'objet');

    const messages = (await recentErrors()).map((e) => e.message);
    expect(messages[0]).toBe('panne texte');
    expect(messages[1]).toContain('42');
  });

  it('garde les erreurs les plus récentes, pas les premières', async () => {
    // Quand une app part en vrille, c'est la dernière erreur qui explique.
    for (let i = 0; i < 35; i += 1) await recordError(new Error(`e${i}`), 'boucle');

    const entries = await recentErrors();
    expect(entries).toHaveLength(30);
    expect(entries[entries.length - 1].message).toBe('e34');
    expect(entries[0].message).toBe('e5');
  });

  it('ne lève jamais si le stockage échoue', async () => {
    failNextSet = true;
    // Doit être silencieux : sinon l'échec du journal devient l'erreur visible.
    await expect(recordError(new Error('x'), 'ctx')).resolves.toBeUndefined();
    expect(await errorCount()).toBe(0);
  });

  it('survit à un journal corrompu sur le disque', async () => {
    store['ocleaneo_error_log'] = '{ ceci n est pas du JSON';
    expect(await recentErrors()).toEqual([]);
    await expect(recordError(new Error('après corruption'), 'ctx')).resolves.toBeUndefined();
  });

  it('produit un texte transmissible, et un message clair quand il est vide', async () => {
    expect(await formatErrorLog()).toBe('Aucune erreur enregistrée.');

    await recordError(new Error('planning introuvable'), 'vue: render');
    const text = await formatErrorLog();
    expect(text).toContain('planning introuvable');
    expect(text).toContain('vue: render');
  });

  it('peut être effacé une fois transmis', async () => {
    await recordError(new Error('x'), 'ctx');
    expect(await errorCount()).toBe(1);

    await clearErrorLog();

    expect(await errorCount()).toBe(0);
  });
});

describe('branchement des gestionnaires globaux', () => {
  it('capte une erreur de rendu Vue', async () => {
    const app = { config: {} as { errorHandler?: (e: unknown, i: unknown, info: string) => void } };
    installErrorHandlers(app);

    app.config.errorHandler?.(new Error('rendu cassé'), null, 'render');
    await vi.waitFor(async () => expect(await errorCount()).toBe(1));

    const [entry] = await recentErrors();
    expect(entry.context).toBe('vue: render');
  });

  it('écoute les promesses rejetées et les erreurs globales', async () => {
    // La suite tourne sans DOM (aucun jsdom installé, et en ajouter un pour ce
    // seul test alourdirait chaque exécution). Un window minimal suffit à
    // vérifier ce qui compte : que les deux écoutes sont bien posées et que ce
    // qu'elles reçoivent finit dans le journal.
    const listeners: Record<string, (e: never) => void> = {};
    vi.stubGlobal('window', {
      addEventListener: (name: string, cb: (e: never) => void) => {
        listeners[name] = cb;
      },
    });

    installErrorHandlers({ config: {} });

    expect(Object.keys(listeners).sort()).toEqual(['error', 'unhandledrejection']);

    listeners.unhandledrejection({ reason: new Error('appel oublié') } as never);
    listeners.error({ error: new Error('script cassé') } as never);

    await vi.waitFor(async () => {
      const messages = (await recentErrors()).map((e) => e.message);
      expect(messages).toContain('appel oublié');
      expect(messages).toContain('script cassé');
    });

    vi.unstubAllGlobals();
  });

  it('ne pose aucune écoute quand il n’y a pas de window', () => {
    vi.stubGlobal('window', undefined);
    // Ne doit pas lever : le module est importé par main.ts, une exception ici
    // empêcherait l'application de démarrer.
    expect(() => installErrorHandlers({ config: {} })).not.toThrow();
    vi.unstubAllGlobals();
  });
});
