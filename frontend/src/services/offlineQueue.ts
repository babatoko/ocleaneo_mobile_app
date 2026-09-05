import { Preferences } from '@capacitor/preferences';
import { Network } from '@capacitor/network';
import { App } from '@capacitor/app';
import { provider } from '../providers';
import { ProviderNetworkError } from '../providers/DataProvider';
import type { CreateTimeEntryPayload, CreateTimeEntryWithTagPayload, TimeEntryType } from '../types/models';

const QUEUE_KEY = 'ocleaneo_pointage_offline_queue';

interface BaseQueuedEntry {
  localId: string;
  clientRef: string;
  type: TimeEntryType;
  recordedAt: string;
  latitude?: number;
  longitude?: number;
  outOfRange?: boolean;
  withTag?: boolean;
}

interface TimeEntryQueuedEntry extends BaseQueuedEntry {
  chantierId: number;
  shiftId?: number;
}

interface TagQueuedEntry extends BaseQueuedEntry {
  withTag: true;
  uid: string;
}

type QueuedEntry = TimeEntryQueuedEntry | TagQueuedEntry;

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
export async function enqueue(payload: CreateTimeEntryPayload | CreateTimeEntryWithTagPayload): Promise<string> {
  const localId = `local-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const queued = 'chantierId' in payload
    ? ({ ...payload, localId } as TimeEntryQueuedEntry)
    : ({ ...payload, localId, withTag: true as const } as TagQueuedEntry);
  await withQueueLock(async () => {
    const queue = await readQueue();
    queue.push(queued);
    await writeQueue(queue);
  });
  return localId;
}

export async function queueLength(): Promise<number> {
  return (await readQueue()).length;
}

/**
 * Pointages que le serveur a refusés pour une raison métier (validation,
 * droits, requête invalide) — conservés au lieu d'être détruits.
 *
 * Le rejeu ne peut pas les garder en file : ils échoueraient à chaque
 * tentative et bloqueraient les pointages suivants derrière eux. Mais les
 * effacer revient à supprimer du temps de travail sur la foi d'une erreur
 * peut-être transitoire, sans que personne ne l'apprenne. Ils sont donc mis
 * de côté ici, avec le motif du refus, et leur nombre remonte à l'écran
 * Profil pour qu'un salarié puisse le signaler plutôt que de découvrir une
 * paie incomplète.
 */
const FAILED_KEY = 'ocleaneo_pointage_failed_entries';

export interface FailedEntry {
  localId: string;
  clientRef: string;
  type: TimeEntryType;
  recordedAt: string;
  latitude?: number;
  longitude?: number;
  outOfRange?: boolean;
  withTag?: boolean;
  chantierId?: number;
  shiftId?: number;
  uid?: string;
  failedAt: string;
  reason: string;
}

async function setAside(entry: QueuedEntry, reason: string): Promise<void> {
  const failedEntry: FailedEntry = {
    localId: entry.localId,
    clientRef: entry.clientRef,
    type: entry.type,
    recordedAt: entry.recordedAt,
    latitude: entry.latitude,
    longitude: entry.longitude,
    outOfRange: entry.outOfRange,
    withTag: entry.withTag,
    failedAt: new Date().toISOString(),
    reason,
  };
  if ('chantierId' in entry) {
    failedEntry.chantierId = entry.chantierId;
    failedEntry.shiftId = entry.shiftId;
  }
  if ('uid' in entry) {
    failedEntry.uid = entry.uid;
  }
  await withQueueLock(async () => {
    const { value } = await Preferences.get({ key: FAILED_KEY });
    const failed: FailedEntry[] = value ? JSON.parse(value) : [];
    failed.push(failedEntry);
    await Preferences.set({ key: FAILED_KEY, value: JSON.stringify(failed) });
  });
}

export async function failedEntries(): Promise<FailedEntry[]> {
  const { value } = await Preferences.get({ key: FAILED_KEY });
  return value ? JSON.parse(value) : [];
}

export async function failedCount(): Promise<number> {
  return (await failedEntries()).length;
}

/** Vide la liste des refus, une fois qu'ils ont été traités côté gestion. */
export async function clearFailedEntries(): Promise<void> {
  await withQueueLock(async () => {
    await Preferences.remove({ key: FAILED_KEY });
  });
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
      const { localId: _localId, withTag, ...payload } = next;
      if (withTag) {
        await provider.createTimeEntryWithTag(payload as CreateTimeEntryWithTagPayload);
      } else {
        await provider.createTimeEntry(payload as CreateTimeEntryPayload);
      }
      flushed += 1;
    } catch (e) {
      if (isNetworkError(e)) break;
      // Erreur métier (validation, droits, requête invalide) : l'entrée sort
      // de la file, sinon elle échouerait à chaque tentative et bloquerait
      // les pointages suivants derrière elle. Mais elle n'est pas détruite —
      // elle part de côté avec son motif, et son nombre remonte à l'écran
      // Profil. Effacer du temps de travail sans que personne ne l'apprenne
      // n'est pas une option acceptable ici.
      await setAside(next, e instanceof Error ? e.message : String(e));
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
