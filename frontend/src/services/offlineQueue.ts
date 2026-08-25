import { Preferences } from '@capacitor/preferences';
import { Network } from '@capacitor/network';
import { App } from '@capacitor/app';
import { Capacitor } from '@capacitor/core';
import { provider } from '../providers';
import { ProviderNetworkError } from '../providers/DataProvider';
import type { CreateTimeEntryPayload } from '../types/models';

const QUEUE_KEY = 'ocleaneo_pointage_offline_queue';

interface QueuedEntry extends CreateTimeEntryPayload {
  localId: string;
}

async function readQueue(): Promise<QueuedEntry[]> {
  if (!Capacitor.isNativePlatform()) return [];
  const { value } = await Preferences.get({ key: QUEUE_KEY });
  return value ? JSON.parse(value) : [];
}

async function writeQueue(queue: QueuedEntry[]): Promise<void> {
  if (!Capacitor.isNativePlatform()) return;
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

/** Relance flushQueue() dès que le réseau revient ou que l'app repasse au premier plan. */
export function watchConnectivity(onReconnect: () => void): void {
  if (watching || !Capacitor.isNativePlatform()) return;
  watching = true;
  Network.addListener('networkStatusChange', (status) => {
    if (status.connected) onReconnect();
  });
  App.addListener('resume', onReconnect);
}
