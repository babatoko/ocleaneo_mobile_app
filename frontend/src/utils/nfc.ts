/**
 * Normalisation des UID NFC — source unique pour toute l'app (F03 de
 * l'audit du 13/09 : trois implémentations divergentes cohabitaient).
 *
 * Les UID arrivent du plugin NFC (souvent "04:51:5D:C9:78:00:00"), du
 * backend Odoo (format avec ":" — champ nfc_tag_id / registre NFC) ou d'une
 * saisie manuelle ("04 17 79…" avec espaces). Tous désignent le même badge
 * physique : seul le hex débarassé de tout séparateur est comparable.
 *
 * La règle doit rester IDENTIQUE à canonical_nfc_uid du registre côté Odoo
 * (odoo/addons/ocleaneo_nfc_tag_registry) : hex-only + minuscules.
 */

/** Hex seul, minuscules — "04:51:5D:C9:78:00:00" → "04515dc9780000".
 *  Élimine ":", "-", espaces et tout autre séparateur de saisie. */
export function normalizeNfcId(value: string): string {
  return value.replace(/[^0-9a-fA-F]/g, '').toLowerCase();
}

/** Reformate un hex brut avec des ":" tous les 2 caractères
 *  ("04:17:79:C9:78:00:00"), directement comparable/copiable dans le champ
 *  nfc_tag_id d'Odoo, saisi sous cette forme. */
export function formatNfcIdWithColons(value: string): string {
  const hex = normalizeNfcId(value).toUpperCase();
  return hex.replace(/(.{2})(?=.)/g, '$1:');
}