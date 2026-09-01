import { describe, expect, it } from 'vitest';
import { groupIntoShifts, fmtDuration, fmtPause } from '../shifts';
import type { TimeEntry } from '../../types/models';

function entry(id: number, type: TimeEntry['type'], time: string, chantier = 1, chantierName = 'Cegetel Macon'): TimeEntry {
  return { id, type, chantier_id: chantier, chantier_name: chantierName, recorded_at: `2026-08-31T${time}:00.000Z` };
}

describe('groupIntoShifts', () => {
  it('regroupe arrivée + départ en une vacation, avec la durée travaillée', () => {
    const shifts = groupIntoShifts([entry(1, 'in', '08:02'), entry(2, 'out', '11:05')]);

    expect(shifts).toHaveLength(1);
    expect(shifts[0].chantierName).toBe('Cegetel Macon');
    expect(shifts[0].endAt).not.toBeNull();
    expect(fmtDuration(shifts[0].workedSeconds)).toBe('3h03');
  });

  it('déduit la pause de la durée travaillée', () => {
    const shifts = groupIntoShifts([
      entry(1, 'in', '14:00', 2, 'Résidence Les Tilleuls'),
      entry(2, 'pause_start', '14:30', 2, 'Résidence Les Tilleuls'),
      entry(3, 'pause_end', '14:45', 2, 'Résidence Les Tilleuls'),
      entry(4, 'out', '16:28', 2, 'Résidence Les Tilleuls'),
    ]);

    expect(shifts).toHaveLength(1);
    expect(fmtPause(shifts[0].pauseSeconds)).toBe('15 min');
    // 2h28 bruts (14h00-16h28) moins 15 min de pause = 2h13.
    expect(fmtDuration(shifts[0].workedSeconds)).toBe('2h13');
  });

  it('sépare deux vacations sur des chantiers différents le même jour', () => {
    const shifts = groupIntoShifts([
      entry(1, 'in', '08:00', 1, 'Cegetel Macon'),
      entry(2, 'out', '11:00', 1, 'Cegetel Macon'),
      entry(3, 'in', '14:00', 2, 'Résidence Les Tilleuls'),
      entry(4, 'out', '16:00', 2, 'Résidence Les Tilleuls'),
    ]);

    expect(shifts).toHaveLength(2);
    expect(shifts[0].chantierName).toBe('Cegetel Macon');
    expect(shifts[1].chantierName).toBe('Résidence Les Tilleuls');
  });

  it("une vacation sans départ badgé reste 'en cours' (endAt null), durée calculée jusqu'à `now`", () => {
    const now = new Date('2026-08-31T10:49:00.000Z');
    const shifts = groupIntoShifts([entry(1, 'in', '08:02')], now);

    expect(shifts).toHaveLength(1);
    expect(shifts[0].endAt).toBeNull();
    expect(fmtDuration(shifts[0].workedSeconds)).toBe('2h47');
  });

  it("une nouvelle arrivée ferme la vacation précédente même sans départ badgé (oubli)", () => {
    const shifts = groupIntoShifts([
      entry(1, 'in', '08:00', 1, 'Cegetel Macon'),
      // Pas de "out" ici — départ oublié.
      entry(2, 'in', '14:00', 2, 'Résidence Les Tilleuls'),
      entry(3, 'out', '16:00', 2, 'Résidence Les Tilleuls'),
    ], new Date('2026-08-31T20:00:00.000Z'));

    expect(shifts).toHaveLength(2);
    expect(shifts[0].chantierName).toBe('Cegetel Macon');
    expect(shifts[0].endAt).toBeNull();
    expect(shifts[1].chantierName).toBe('Résidence Les Tilleuls');
    expect(shifts[1].endAt).not.toBeNull();
  });

  it('ignore une liste vide', () => {
    expect(groupIntoShifts([])).toEqual([]);
  });
});

describe('fmtDuration / fmtPause', () => {
  it('formate les secondes en heures/minutes', () => {
    expect(fmtDuration(0)).toBe('0h00');
    expect(fmtDuration(3600)).toBe('1h00');
    expect(fmtDuration(9780)).toBe('2h43');
  });

  it('formate une pause en minutes', () => {
    expect(fmtPause(900)).toBe('15 min');
  });
});
