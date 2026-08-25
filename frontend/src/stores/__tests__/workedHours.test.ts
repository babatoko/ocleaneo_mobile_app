import { describe, expect, it } from 'vitest';
import { computeWorkedHours } from '../pointage';
import type { TimeEntry, TimeEntryType } from '../../types/models';

// Ce calcul alimente le compteur d'heures de la semaine et l'alerte de
// dépassement : une erreur ici se traduit en heures fausses sur une fiche de
// paie. C'est la logique la plus à risque de l'application.

let nextId = 1;
const e = (type: TimeEntryType, time: string): TimeEntry => ({
  id: nextId++,
  chantier_id: 1,
  type,
  recorded_at: `2026-08-24T${time}:00`,
});
const at = (time: string) => new Date(`2026-08-24T${time}:00`);

describe('computeWorkedHours', () => {
  it('compte une vacation simple arrivée/départ', () => {
    expect(computeWorkedHours([e('in', '08:00'), e('out', '11:00')])).toBe(3);
  });

  it('déduit une pause terminée', () => {
    const entries = [e('in', '08:00'), e('pause_start', '10:00'), e('pause_end', '10:30'), e('out', '12:00')];
    expect(computeWorkedHours(entries)).toBe(3.5);
  });

  it('déduit une pause close par le départ (reprise oubliée)', () => {
    // L'agent part sans badger sa reprise : la pause court jusqu'au départ et
    // ne doit pas être comptée comme du temps travaillé.
    const entries = [e('in', '08:00'), e('pause_start', '10:00'), e('out', '11:00')];
    expect(computeWorkedHours(entries)).toBe(2);
  });

  it('compte une session encore ouverte jusqu\'à maintenant', () => {
    expect(computeWorkedHours([e('in', '08:00')], at('09:30'))).toBe(1.5);
  });

  it('fige le compteur pendant une pause en cours', () => {
    const entries = [e('in', '08:00'), e('pause_start', '09:00')];
    // Il est 10h mais la pause a démarré à 9h : le total reste à 1h.
    expect(computeWorkedHours(entries, at('10:00'))).toBe(1);
  });

  it('additionne plusieurs vacations dans la journée', () => {
    const entries = [
      e('in', '08:00'), e('out', '11:00'),
      e('in', '14:00'), e('out', '16:30'),
    ];
    expect(computeWorkedHours(entries)).toBe(5.5);
  });

  it('remet les entrées dans l\'ordre chronologique', () => {
    const entries = [e('out', '11:00'), e('in', '08:00')];
    expect(computeWorkedHours(entries)).toBe(3);
  });

  it('ne renvoie jamais un total négatif', () => {
    // Données incohérentes (départ sans arrivée) : mieux vaut 0 qu'un négatif.
    expect(computeWorkedHours([e('out', '11:00')])).toBe(0);
  });

  it('renvoie 0 sans aucun pointage', () => {
    expect(computeWorkedHours([])).toBe(0);
  });
});
