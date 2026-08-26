import { describe, expect, it } from 'vitest';
import { turnByTurnHref } from '../navigation';

describe('turnByTurnHref', () => {
  it('guide vers les coordonnées quand elles sont connues', () => {
    const href = turnByTurnHref({ latitude: 46.3069, longitude: 4.8285 });
    expect(href).toContain('46.3069');
    expect(href).toContain('4.8285');
  });

  it('guide vers une coordonnée à 0 (équateur/méridien) plutôt que de retomber sur l\'adresse', () => {
    // 0 est une coordonnée réelle, pas une valeur "manquante" — cf. checkGeofence().
    const href = turnByTurnHref({ latitude: 0, longitude: 0, address: 'Ne devrait pas être utilisée' });
    expect(href).not.toContain('Ne devrait pas être utilisée');
    expect(href).toMatch(/[?&](daddr|destination)=0,0/);
  });

  it('retombe sur une recherche par adresse sans coordonnées', () => {
    const href = turnByTurnHref({ address: '12 rue des Frères Lumière, Mâcon' });
    expect(href).toContain('maps.google.com');
    expect(href).toContain(encodeURIComponent('12 rue des Frères Lumière, Mâcon'));
  });
});
