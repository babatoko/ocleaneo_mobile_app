import type { TimeEntry } from '../types/models';

/**
 * Une "vacation" regroupe les pointages bruts d'un même passage sur un
 * chantier : de l'arrivée jusqu'au départ qui suit (ou jusqu'à la fin des
 * pointages connus, si le départ n'a pas encore été badgé). Affichés en
 * liste plate (un pointage par ligne), ils obligeaient à recouper
 * mentalement les heures pour connaître le chantier et la durée réellement
 * travaillée — voir le mockup de ocleaneo_mobile_app#40.
 */
export interface Shift {
  id: string;
  chantierName: string;
  entries: TimeEntry[];
  startAt: string;
  endAt: string | null; // null : départ pas encore badgé (vacation en cours)
  pauseSeconds: number;
  workedSeconds: number;
}

/**
 * `dayEntries` doit être trié par `recorded_at` croissant et ne couvrir
 * qu'un seul jour — le regroupement ne réordonne ni ne filtre lui-même.
 */
export function groupIntoShifts(dayEntries: TimeEntry[], now: Date = new Date()): Shift[] {
  const shifts: Shift[] = [];
  let current: TimeEntry[] = [];

  function flush() {
    if (current.length) shifts.push(buildShift(current, now));
    current = [];
  }

  for (const e of dayEntries) {
    // Une nouvelle arrivée ferme la vacation précédente, même si son départ
    // n'a jamais été badgé (oubli) — sans quoi elle absorberait la suivante.
    if (e.type === 'in' && current.length) flush();
    current.push(e);
  }
  flush();

  return shifts;
}

function buildShift(shiftEntries: TimeEntry[], now: Date): Shift {
  const first = shiftEntries[0];
  const last = shiftEntries[shiftEntries.length - 1];
  const startAt = first.recorded_at;
  const endAt = last.type === 'out' ? last.recorded_at : null;

  let pauseMs = 0;
  let pauseStart: string | null = null;
  for (const e of shiftEntries) {
    if (e.type === 'pause_start') pauseStart = e.recorded_at;
    else if (e.type === 'pause_end' && pauseStart) {
      pauseMs += new Date(e.recorded_at).getTime() - new Date(pauseStart).getTime();
      pauseStart = null;
    }
  }

  // Une vacation en cours (pas de départ badgé) affiche la durée écoulée au
  // moment du chargement de l'écran, pas un chrono qui tourne en direct —
  // un simple tirer-pour-rafraîchir suffit à l'actualiser.
  const endRef = endAt || now.toISOString();
  const workedMs = new Date(endRef).getTime() - new Date(startAt).getTime() - pauseMs;

  return {
    id: String(first.id),
    chantierName: first.chantier_name || '',
    entries: shiftEntries,
    startAt,
    endAt,
    pauseSeconds: Math.round(pauseMs / 1000),
    workedSeconds: Math.max(0, Math.round(workedMs / 1000)),
  };
}

/** "2h47" — même convention que weekHoursLabel (PointageView.vue). */
export function fmtDuration(totalSeconds: number): string {
  const totalMinutes = Math.round(totalSeconds / 60);
  return `${Math.floor(totalMinutes / 60)}h${String(totalMinutes % 60).padStart(2, '0')}`;
}

/** "15 min" */
export function fmtPause(totalSeconds: number): string {
  return `${Math.round(totalSeconds / 60)} min`;
}
