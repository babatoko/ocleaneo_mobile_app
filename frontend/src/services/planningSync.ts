import { Preferences } from '@capacitor/preferences';
import { Capacitor } from '@capacitor/core';
import {
  scheduleShiftReminder,
  cancelShiftReminder,
  scheduleLateReminder,
  cancelLateReminder,
  notifyPlanningChanged,
} from './notifications';
import type { Shift } from '../types/models';

const SNAPSHOT_KEY = 'ocleaneo_planning_snapshot';
// Fenêtre dans laquelle un changement déclenche une notification et un
// rappel est programmé. Au-delà, une vacation qui n'apparaît pas encore dans
// un appel donné n'est pas forcément « annulée » — elle peut juste être hors
// de la plage de dates demandée (jour/semaine/mois chargent des fenêtres
// différentes) : on ne peut donc fiablement détecter que les changements sur
// les vacations proches, pas les nouvelles vacations ni les annulations sur
// l'ensemble du planning sans backend dédié (voir README).
const NEAR_TERM_WINDOW_H = 48;

type Snapshot = Record<number, string>;

function fingerprint(s: Shift): string {
  return `${s.start_at}|${s.end_at}|${s.status}|${s.note || ''}`;
}

async function readSnapshot(): Promise<Snapshot> {
  if (!Capacitor.isNativePlatform()) return {};
  const { value } = await Preferences.get({ key: SNAPSHOT_KEY });
  return value ? JSON.parse(value) : {};
}

async function writeSnapshot(snap: Snapshot): Promise<void> {
  if (!Capacitor.isNativePlatform()) return;
  await Preferences.set({ key: SNAPSHOT_KEY, value: JSON.stringify(snap) });
}

function fmtDate(iso: string): string {
  return new Date(iso).toLocaleDateString('fr-FR', { weekday: 'short', day: 'numeric', month: 'short' });
}

function fmtTime(iso: string): string {
  return new Date(iso).toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' });
}

/**
 * À appeler après chaque chargement de vacations (jour/semaine/mois) :
 * programme un rappel avant chaque vacation proche et notifie les
 * changements détectés sur les vacations proches par rapport à la dernière
 * fois qu'elles ont été vues.
 */
export async function syncShifts(shifts: Shift[]): Promise<void> {
  if (!Capacitor.isNativePlatform()) return;
  const snapshot = await readSnapshot();
  const changes: string[] = [];
  const now = Date.now();

  for (const s of shifts) {
    const fp = fingerprint(s);
    const prev = snapshot[s.id];
    const hoursUntil = (new Date(s.start_at).getTime() - now) / 3600000;
    const isNearTerm = hoursUntil > 0 && hoursUntil <= NEAR_TERM_WINDOW_H;

    if (isNearTerm && prev !== undefined && prev !== fp) {
      changes.push(`${s.chantier_name} modifié — ${fmtDate(s.start_at)} à ${fmtTime(s.start_at)}.`);
    }
    snapshot[s.id] = fp;

    if (isNearTerm) await scheduleShiftReminder(s);
    else await cancelShiftReminder(s.id);

    // Programmé sans savoir si le salarié a déjà badgé son arrivée pour
    // cette vacation — c'est pointage.clockWithTag() qui annule ce rappel
    // précisément dès qu'un pointage d'arrivée est enregistré.
    if (isNearTerm) await scheduleLateReminder(s);
    else await cancelLateReminder(s.id);
  }

  await writeSnapshot(snapshot);

  if (changes.length === 1) {
    await notifyPlanningChanged(changes[0]);
  } else if (changes.length > 1) {
    await notifyPlanningChanged(`${changes.length} vacations proches ont été modifiées sur votre planning.`);
  }
}
