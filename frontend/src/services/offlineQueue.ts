import { Preferences } from '@capacitor/preferences';
import { Network } from '@capacitor/network';
import { App } from '@capacitor/app';
import { provider } from '../providers';
import { ProviderNetworkError } from '../providers/DataProvider';
import type { CreateTimeEntryPayload } from '../types/models';

const QUEUE_KEY = 'ocleaneo_pointage_offline_queue';

interface QueuedEntry extends CreateTimeEntryPayload {
  localId: string;
}

// Pas de garde sur la plateforme : @capacitor/preferences retombe sur
// localStorage dans le navigateur — même raisonnement que le cache du planning
// (stores/planning.ts) et celui des chantiers. Avec une garde native, `enqueue`
// ne persistait rien en PWA alors que l'écran affichait « pointage enregistré,
// synchronisation dès que possible » : le pointage était perdu en silence.
async function readQueue(): Promise<QueuedEntry[]> {
  const { value } = await Preferences.get({ key: QUEUE_KEY });
  return value ? JSON.parse(value) : [];
}

async function writeQueue(queue: QueuedEntry[]): Promise<void> {
  await Preferences.set({ key: QUEUE_KEY, value: JSON.stringify(queue) });
}

/**
 * Sérialise les accès à la file. Lire puis réécrire n'est pas atomique : le
 * stockage est asynchrone, donc deux opérations lancées en même temps lisent
 * le même état de départ et la dernière écriture écrase l'autre.
 *
 * Ce n'était pas théorique. Le réseau qui revient déclenche un flush, et le
 * salarié qui badge au même instant déclenche un enqueue — c'est le scénario
 * normal, pas un cas limite. Reproduit avec une latence réseau réaliste (un
 * POST est bien plus lent qu'une écriture locale) : le flush lisait `[A]`,
 * l'enqueue écrivait `[A, B]`, puis le flush écrivait ce qu'il croyait rester
 * — `[]`. Le pointage B n'était jamais parti et n'était plus en file, alors
 * que l'écran venait d'afficher « pointage enregistré ». Une heure de travail
 * effacée en silence.
 *
 * Une chaîne de promesses suffit : chaque section critique attend la
 * précédente. `.then(fn, fn)` et non `.then(fn)` — un échec ne doit pas
 * bloquer définitivement la file derrière lui.
 */
let queueLock: Promise<unknown> = Promise.resolve();

function withQueueLock<T>(section: () => Promise<T>): Promise<T> {
  const run = queueLock.then(section, section);
  queueLock = run.then(
    () => undefined,
    () => undefined,
  );
  return run;
}

export function isNetworkError(e: unknown): boolean {
  return e instanceof ProviderNetworkError; // posé par tout DataProvider pour une coupure réseau (voir providers/DataProvider.ts)
}

/** Ajoute un pointage à la file d'attente locale (persistante) et renvoie son id local. */
export async function enqueue(payload: CreateTimeEntryPayload): Promise<string> {
  const localId = `local-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  await withQueueLock(async () => {
    const queue = await readQueue();
    queue.push({ ...payload, localId });
    await writeQueue(queue);
  });
  return localId;
}

export async function queueLength(): Promise<number> {
  return (await readQueue()).length;
}

/** Retire une entrée précise, par identité et jamais par position.
 *
 *  Le rejeu relit la file après chaque envoi réseau, et elle a pu changer
 *  entre-temps (un pointage ajouté pendant le POST). Écrire « le reste du
 *  tableau lu avant l'envoi » effaçait ces ajouts ; filtrer sur le localId ne
 *  touche que l'entrée effectivement traitée. */
async function removeFromQueue(localId: string): Promise<void> {
  await withQueueLock(async () => {
    const queue = await readQueue();
    await writeQueue(queue.filter((entry) => entry.localId !== localId));
  });
}

/**
 * Rejoue la file dans l'ordre (important pour préserver l'alternance
 * arrivée/départ) ; s'arrête à la première entrée qui échoue encore pour
 * cause réseau — les entrées suivantes attendront la prochaine tentative.
 *
 * Le verrou n'est jamais tenu pendant l'appel réseau : seules les lectures et
 * écritures de la file sont sérialisées. Un POST lent ne doit pas empêcher un
 * salarié de badger — c'est justement ce qui remplit la file.
 */
async function drainQueue(): Promise<{ flushed: number; remaining: number }> {
  let flushed = 0;
  for (;;) {
    const next = await withQueueLock(async () => (await readQueue())[0]);
    if (!next) break;

    try {
      const { localId: _localId, ...payload } = next;
      await provider.createTimeEntry(payload);
      flushed += 1;
    } catch (e) {
      if (isNetworkError(e)) break;
      // Erreur métier (ex: doublon rejeté par le serveur) : on abandonne cette
      // entrée plutôt que de bloquer indéfiniment les suivantes derrière elle.
      // Reste à traiter (F-04 de l'audit) : l'abandon est silencieux, alors
      // qu'il porte sur du temps de travail.
    }
    await removeFromQueue(next.localId);
  }
  return { flushed, remaining: await queueLength() };
}

/**
 * Un seul rejeu à la fois. `watchConnectivity` pose DEUX déclencheurs
 * (retour du réseau, retour au premier plan) qui se produisent volontiers
 * ensemble — le salarié rentre dans la zone wifi et rouvre l'app. Deux rejeux
 * concurrents enverraient chaque pointage deux fois : sans dommage côté
 * serveur grâce à `client_ref`, mais pour rien, et sur un lien mobile.
 */
let inFlight: Promise<{ flushed: number; remaining: number }> | null = null;

export function flushQueue(): Promise<{ flushed: number; remaining: number }> {
  if (inFlight) return inFlight;
  inFlight = drainQueue().finally(() => {
    inFlight = null;
  });
  return inFlight;
}

let watching = false;

/**
 * Relance flushQueue() dès que le réseau revient ou que l'app repasse au
 * premier plan. Actif aussi en PWA : les deux plugins ont une implémentation
 * web (`online`/`offline` pour Network, `visibilitychange` pour App.resume),
 * sans quoi la file se remplirait dans le navigateur sans jamais se vider.
 */
export function watchConnectivity(onReconnect: () => void): void {
  if (watching) return;
  watching = true;
  Network.addListener('networkStatusChange', (status) => {
    if (status.connected) onReconnect();
  });
  App.addListener('resume', onReconnect);
}
