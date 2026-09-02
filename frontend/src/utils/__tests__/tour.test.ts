import { describe, expect, it } from 'vitest';
import { bubbleBottom, clampTailX, spotlightRect } from '../tour';

describe('spotlightRect', () => {
  it('ajoute une marge respirante autour de la cible', () => {
    const rect = spotlightRect({ left: 100, top: 500, width: 60, height: 40 }, 6);
    expect(rect).toEqual({ left: 94, top: 494, width: 72, height: 52 });
  });

  it('utilise 6px de marge par défaut', () => {
    const rect = spotlightRect({ left: 0, top: 0, width: 50, height: 50 });
    expect(rect.left).toBe(-6);
    expect(rect.width).toBe(62);
  });
});

describe('bubbleBottom', () => {
  it("place la bulle juste au-dessus du haut mesuré de la barre de navigation", () => {
    // Barre de nav commençant à 700px sur un écran de 812px de haut : la bulle
    // doit se poser à 112 (=812-700) + 12px de respiration = 124px du bas.
    expect(bubbleBottom(700, 812, 12)).toBe(124);
  });

  it('utilise 12px de respiration par défaut', () => {
    expect(bubbleBottom(700, 812)).toBe(124);
  });
});

describe('clampTailX', () => {
  it('suit le centre de la cible quand il reste loin des bords', () => {
    expect(clampTailX(200, 400, 40)).toBe(200);
  });

  it('ne laisse jamais la pointe sortir par la gauche', () => {
    expect(clampTailX(10, 400, 40)).toBe(40);
  });

  it('ne laisse jamais la pointe sortir par la droite', () => {
    expect(clampTailX(390, 400, 40)).toBe(360);
  });
});
