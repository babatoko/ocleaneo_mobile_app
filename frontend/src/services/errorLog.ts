import { Preferences } from '@capacitor/preferences';

/**
 * Journal local des erreurs non rattrapées.
 *
 * L'app n'avait aucune remontée : ni `app.config.errorHandler`, ni écoute de
 * `unhandledrejection`, ni `window.onerror`. Un plantage sur le téléphone d'un
 * agent était donc totalement invisible — personne ne l'apprenait sauf s'il
 * appelait, et il ne pouvait alors décrire que le symptôme. On ne corrige pas
 * ce qu'on ne voit pas.
 *
 * Le choix ici est délibérément local : aucune donnée ne quitte l'appareil.
 * Brancher un service tiers (Sentry ou autre) enverrait des traces hors de
 * l'entreprise et engage une décision qui n'est pas technique — c'est à
 * Ocleaneo de la prendre, pas à ce module de la préempter. Le journal rend le
 * défaut *observable* ; le salarié peut le transmettre depuis son profil, et
 * l'envoi automatique reste une évolution possible par-dessus.
 */

const LOG_KEY = 'ocleaneo_error_log';

/** Assez pour reconstituer un enchaînement, trop peu pour peser sur le
 *  stockage d'un téléphone bas de gamme — ce que beaucoup d'agents ont. */
const MAX_ENTRIES = 30;

export interface LoggedError {
  at: string;
  context: string;
  message: string;
  stack?: string;
}

/** Une erreur pendant l'écriture du journal ne doit jamais devenir l'erreur
 *  visible : elle masquerait celle qu'on cherchait à consigner. */
async function safely<T>(fn: () => Promise<T>, fallback: T): Promise<T> {
  try {
    return await fn();
  } catch {
    return fallback;
  }
}

/**
 * Sérialise les écritures, pour la même raison que la file hors ligne
 * (services/offlineQueue.ts) : lire puis réécrire n'est pas atomique.
 *
 * Le cas est ici plus probable qu'ailleurs — les erreurs arrivent rarement
 * seules, une cascade en produit plusieurs dans le même tour de boucle. Sans
 * sérialisation, chaque écriture repart de l'état lu avant les autres et
 * n'en conserve qu'une : un journal censé reconstituer un enchaînement ne
 * garderait que le dernier maillon. Attrapé par son propre test.
 */
let writeLock: Promise<unknown> = Promise.resolve();

function serialized<T>(section: () => Promise<T>): Promise<T> {
  const run = writeLock.then(section, section);
  writeLock = run.then(
    () => undefined,
    () => undefined,
  );
  return run;
}

function describe(error: unknown): { message: string; stack?: string } {
  if (error instanceof Error) {
    return { message: error.message || error.name, stack: error.stack };
  }
  if (typeof error === 'string') return { message: error };
  try {
    return { message: JSON.stringify(error) };
  } catch {
    return { message: String(error) };
  }
}

export async function recordError(error: unknown, context: string): Promise<void> {
  const entry = { at: new Date().toISOString(), context, ...describe(error) };
  await serialized(() =>
    safely(async () => {
      const entries = await readLog();
      entries.push(entry);
      // Le tampon garde les plus RÉCENTES : quand une app part en vrille, c'est
      // la dernière erreur qui explique, pas la première.
      const kept = entries.slice(-MAX_ENTRIES);
      await Preferences.set({ key: LOG_KEY, value: JSON.stringify(kept) });
    }, undefined),
  );
}

async function readLog(): Promise<LoggedError[]> {
  return safely(async () => {
    const { value } = await Preferences.get({ key: LOG_KEY });
    const parsed = value ? JSON.parse(value) : [];
    return Array.isArray(parsed) ? parsed : [];
  }, []);
}

export async function recentErrors(): Promise<LoggedError[]> {
  return readLog();
}

export async function errorCount(): Promise<number> {
  return (await readLog()).length;
}

export async function clearErrorLog(): Promise<void> {
  await serialized(() => safely(() => Preferences.remove({ key: LOG_KEY }), undefined));
}

/** Texte transmissible à un responsable ou au support. Volontairement brut :
 *  il sera lu par quelqu'un qui cherche une cause, pas mis en page. */
export async function formatErrorLog(): Promise<string> {
  const entries = await readLog();
  if (!entries.length) return 'Aucune erreur enregistrée.';
  return entries
    .map((e) => `[${e.at}] ${e.context}\n${e.message}${e.stack ? `\n${e.stack}` : ''}`)
    .join('\n\n');
}

/**
 * Branche les trois sources d'erreur non rattrapée du navigateur. Séparé de
 * main.ts pour rester testable sans monter l'application.
 */
export function installErrorHandlers(app: { config: { errorHandler?: unknown } }): void {
  app.config.errorHandler = (error: unknown, _instance: unknown, info: string) => {
    void recordError(error, `vue: ${info}`);
  };

  if (typeof window !== 'undefined') {
    window.addEventListener('unhandledrejection', (event) => {
      void recordError(event.reason, 'promesse non rattrapée');
    });
    window.addEventListener('error', (event) => {
      void recordError(event.error ?? event.message, 'erreur globale');
    });
  }
}
