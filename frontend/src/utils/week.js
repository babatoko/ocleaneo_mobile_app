export function startOfWeekIso(dateIso) {
  const d = new Date(dateIso + 'T00:00:00');
  const day = (d.getDay() + 6) % 7; // 0 = lundi
  d.setDate(d.getDate() - day);
  return d.toISOString().slice(0, 10);
}

export function startOfMonthIso(dateIso) {
  const d = new Date(dateIso + 'T00:00:00');
  return new Date(d.getFullYear(), d.getMonth(), 1).toISOString().slice(0, 10);
}

export function endOfMonthIso(dateIso) {
  const d = new Date(dateIso + 'T00:00:00');
  return new Date(d.getFullYear(), d.getMonth() + 1, 0).toISOString().slice(0, 10);
}
