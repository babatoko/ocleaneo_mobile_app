import { toLocalIso } from './date';

// Toutes ces bornes servent à interroger le backend sur des journées entières :
// elles doivent être exprimées dans le fuseau du salarié, pas en UTC (voir
// utils/date.js).

export function startOfWeekIso(dateIso) {
  const d = new Date(dateIso + 'T00:00:00');
  const day = (d.getDay() + 6) % 7; // 0 = lundi
  d.setDate(d.getDate() - day);
  return toLocalIso(d);
}

export function startOfMonthIso(dateIso) {
  const d = new Date(dateIso + 'T00:00:00');
  return toLocalIso(new Date(d.getFullYear(), d.getMonth(), 1));
}

export function endOfMonthIso(dateIso) {
  const d = new Date(dateIso + 'T00:00:00');
  return toLocalIso(new Date(d.getFullYear(), d.getMonth() + 1, 0));
}
