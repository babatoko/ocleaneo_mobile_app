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

export function isNetworkError(e: unknown): boolean {
  return e instanceof ProviderNetworkError; // posé par tout DataProvider pour une coupure réseau (voir providers/DataProvider.ts)
}

/** Ajoute un pointage à la file d'attente locale (persistante) et renvoie son id local. */
export async function enqueue(payload: CreateTimeEntryPayload): Promise<string> {
  const queue = await readQueue();
  const localId = `local-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  queue.push({ ...payload, localId });
  await writeQueue(queue);
  return localId;
}

export async function queueLength(): Promise<number> {
  return (await readQueue()).length;
}

/**
 * Rejoue la file dans l'ordre (important pour préserver l'alternance
 * arrivée/départ) ; s'arrête à la première entrée qui échoue encore pour
 * cause réseau — les entrées suivantes attendront la prochaine tentative.
 */
export async function flushQueue(): Promise<{ flushed: number; remaining: number }> {
  let queue = await readQueue();
  let flushed = 0;
  while (queue.length) {
    const [next, ...rest] = queue;
    try {
      const { localId: _localId, ...payload } = next;
      await provider.createTimeEntry(payload);
      queue = rest;
      flushed += 1;
      await writeQueue(queue);
    } catch (e) {
      if (isNetworkError(e)) break;
      // Erreur métier (ex: doublon rejeté par le serveur) : on abandonne cette
      // entrée plutôt que de bloquer indéfiniment les suivantes derrière elle.
      queue = rest;
      await writeQueue(queue);
    }
  }
  return { flushed, remaining: queue.length };
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
