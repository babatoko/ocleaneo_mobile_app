export function startOfWeekIso(dateIso) {
  const d = new Date(dateIso + 'T00:00:00');
  const day = (d.getDay() + 6) % 7; // 0 = lundi
  d.setDate(d.getDate() - day);
  return d.toISOString().slice(0, 10);
}
