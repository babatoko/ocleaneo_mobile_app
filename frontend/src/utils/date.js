/**
 * Date seule (AAAA-MM-JJ) dans le fuseau de l'appareil.
 *
 * `toISOString().slice(0, 10)` passe par UTC : en France (UTC+1/+2), tout ce
 * qui se produit entre minuit et 2h du matin est daté de la veille. Les
 * équipes de nettoyage démarrant régulièrement avant l'aube, ce décalage
 * ferait afficher le mauvais planning et rattacherait un pointage au mauvais
 * jour. On construit donc la chaîne à partir des composantes locales.
 */
export function toLocalIso(date = new Date()) {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

/** Date d'aujourd'hui au format AAAA-MM-JJ, fuseau local. */
export function todayIso() {
  return toLocalIso();
}

/** Décale une date ISA (AAAA-MM-JJ) de n jours, en restant en local. */
export function addDaysIso(iso, n) {
  const d = new Date(iso + 'T00:00:00');
  d.setDate(d.getDate() + n);
  return toLocalIso(d);
}
