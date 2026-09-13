/**
 * Libellés français des statuts exposés par le backend.
 *
 * Deux vocabulaires coexistent :
 * - les vacations du planning (`/planning`, `ShiftStatus`) : confirmed /
 *   modified / partial / done / cancelled ;
 * - les commandes produits (`OrderStatus`, MockProvider) : confirmed /
 *   pending / cancelled / done / draft.
 *
 * Un statut inconnu (backend plus récent que l'app) est renvoyé tel quel
 * plutôt que masqué : l'agent voit la valeur brute, jamais un vide inexpliqué.
 */

export const SHIFT_STATUS_LABELS: Record<string, string> = {
  confirmed: 'confirmé',
  modified: 'modifié',
  partial: 'fait partiellement',
  done: 'terminé',
  cancelled: 'annulé',
};

export const ORDER_STATUS_LABELS: Record<string, string> = {
  confirmed: 'confirmée',
  pending: 'en attente',
  cancelled: 'annulée',
  done: 'terminée',
  draft: 'brouillon',
};

export function shiftStatusLabel(status: string): string {
  return SHIFT_STATUS_LABELS[status] ?? status;
}

export function orderStatusLabel(status: string): string {
  return ORDER_STATUS_LABELS[status] ?? status;
}