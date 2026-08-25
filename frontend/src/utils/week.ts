import { toLocalIso } from './date';

// Toutes ces bornes servent à interroger le backend sur des journées entières :
// elles doivent être exprimées dans le fuseau du salarié, pas en UTC (voir
// utils/date.ts).

export function startOfWeekIso(dateIso: string): string {
  const d = new Date(dateIso + 'T00:00:00');
  const day = (d.getDay() + 6) % 7; // 0 = lundi
  d.setDate(d.getDate() - day);
  return toLocalIso(d);
}

export function startOfMonthIso(dateIso: string): string {
  const d = new Date(dateIso + 'T00:00:00');
  return toLocalIso(new Date(d.getFullYear(), d.getMonth(), 1));
}

export function endOfMonthIso(dateIso: string): string {
  const d = new Date(dateIso + 'T00:00:00');
  return toLocalIso(new Date(d.getFullYear(), d.getMonth() + 1, 0));
}
