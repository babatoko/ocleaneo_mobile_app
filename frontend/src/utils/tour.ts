/** Géométrie du tour guidé, extraite de OnboardingTour.vue pour rester
 *  testable sans monter de composant (voir shifts.ts pour le même choix). */

export interface Rect {
  left: number;
  top: number;
  width: number;
  height: number;
}

/** Rectangle de la découpe lumineuse : la cible, avec une marge respirante. */
export function spotlightRect(target: Rect, pad = 6): Rect {
  return {
    left: target.left - pad,
    top: target.top - pad,
    width: target.width + pad * 2,
    height: target.height + pad * 2,
  };
}

/** Distance depuis le bas de l'écran à laquelle poser la bulle, juste
 *  au-dessus de la barre de navigation (mesurée, pas supposée : sa hauteur
 *  varie avec la safe-area). */
export function bubbleBottom(navTop: number, viewportHeight: number, gap = 12): number {
  return viewportHeight - navTop + gap;
}

/** Position horizontale de la pointe de la bulle, alignée sur le centre de
 *  la cible mais toujours à l'intérieur de l'écran. */
export function clampTailX(targetCenterX: number, viewportWidth: number, margin = 40): number {
  return Math.min(Math.max(targetCenterX, margin), viewportWidth - margin);
}
