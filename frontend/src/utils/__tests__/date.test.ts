import { describe, expect, it } from 'vitest';
import { toLocalIso, addDaysIso } from '../date';
import { startOfWeekIso, startOfMonthIso, endOfMonthIso } from '../week';

// Le bug historique : `toISOString().slice(0, 10)` date en UTC, donc en France
// tout ce qui se passe entre minuit et 2h du matin était rattaché à la veille.
// Les équipes de nettoyage démarrent régulièrement avant l'aube.

describe('toLocalIso', () => {
  it('garde la date locale juste après minuit', () => {
    // 00h30 le 24 août, heure locale. En UTC+2 c'est encore le 23 en UTC.
    const d = new Date(2026, 7, 24, 0, 30, 0);
    expect(toLocalIso(d)).toBe('2026-08-24');
  });

  it('garde la date locale juste avant minuit', () => {
    const d = new Date(2026, 7, 24, 23, 45, 0);
    expect(toLocalIso(d)).toBe('2026-08-24');
  });

  it('complète le mois et le jour sur deux chiffres', () => {
    expect(toLocalIso(new Date(2026, 0, 5, 12, 0, 0))).toBe('2026-01-05');
  });
});

describe('addDaysIso', () => {
  it('avance de quelques jours', () => {
    expect(addDaysIso('2026-08-24', 6)).toBe('2026-08-30');
  });

  it('recule et franchit un changement de mois', () => {
    expect(addDaysIso('2026-08-02', -5)).toBe('2026-07-28');
  });

  it('franchit un changement d\'année', () => {
    expect(addDaysIso('2026-12-30', 3)).toBe('2027-01-02');
  });

  it('gère le 29 février d\'une année bissextile', () => {
    expect(addDaysIso('2028-02-28', 1)).toBe('2028-02-29');
  });
});

describe('bornes de semaine et de mois', () => {
  it('ramène au lundi de la semaine', () => {
    // 2026-08-24 est un lundi ; le 2026-08-30 un dimanche.
    expect(startOfWeekIso('2026-08-24')).toBe('2026-08-24');
    expect(startOfWeekIso('2026-08-30')).toBe('2026-08-24');
  });

  it('encadre le mois', () => {
    expect(startOfMonthIso('2026-08-24')).toBe('2026-08-01');
    expect(endOfMonthIso('2026-08-24')).toBe('2026-08-31');
  });

  it('trouve le bon dernier jour de février', () => {
    expect(endOfMonthIso('2026-02-10')).toBe('2026-02-28');
    expect(endOfMonthIso('2028-02-10')).toBe('2028-02-29');
  });
});
