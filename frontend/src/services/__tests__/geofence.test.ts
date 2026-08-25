import { describe, expect, it } from 'vitest';
import { checkGeofence, distanceMeters, GEOFENCE_TOLERANCE_M } from '../geofence';

const cegetel = { latitude: 46.3069, longitude: 4.8286 }; // Mâcon

describe('distanceMeters', () => {
  it('renvoie 0 pour deux fois le même point', () => {
    expect(distanceMeters(cegetel, cegetel)).toBeCloseTo(0, 5);
  });

  it('mesure une distance plausible entre deux villes', () => {
    const tournus = { latitude: 46.5667, longitude: 4.9106 };
    // Mâcon–Tournus : environ 30 km à vol d'oiseau.
    const d = distanceMeters(cegetel, tournus);
    expect(d).toBeGreaterThan(28000);
    expect(d).toBeLessThan(32000);
  });
});

describe('checkGeofence', () => {
  it('ne vérifie rien sans position de l\'appareil', () => {
    expect(checkGeofence(null, { ...cegetel })).toBeNull();
  });

  it('ne vérifie rien si le chantier n\'a pas de coordonnées', () => {
    expect(checkGeofence(cegetel, {})).toBeNull();
  });

  it('vérifie bien un chantier sur l\'équateur ou le méridien (latitude/longitude à 0)', () => {
    // 0 est une coordonnée réelle, pas une valeur "manquante" — `!chantier.latitude`
    // la traitait par erreur comme telle et désactivait silencieusement la
    // vérification pour tout chantier sur l'équateur ou le méridien de Greenwich.
    const surLEquateur = { latitude: 0, longitude: 4.8286 };
    const res = checkGeofence(surLEquateur, surLEquateur);
    expect(res).not.toBeNull();
    expect(res!.withinRange).toBe(true);
  });

  it('accepte une position sur le site', () => {
    const res = checkGeofence(cegetel, { ...cegetel });
    expect(res!.withinRange).toBe(true);
    expect(res!.distanceMeters).toBe(0);
  });

  it('accepte une position dans la tolérance (parking, sous-sol)', () => {
    // ~100 m au nord, sous la tolérance de 150 m.
    const proche = { latitude: cegetel.latitude + 0.0009, longitude: cegetel.longitude };
    const res = checkGeofence(proche, { ...cegetel });
    expect(res!.distanceMeters).toBeLessThan(GEOFENCE_TOLERANCE_M);
    expect(res!.withinRange).toBe(true);
  });

  it('signale une position nettement hors zone sans la bloquer', () => {
    const loin = { latitude: cegetel.latitude + 0.01, longitude: cegetel.longitude };
    const res = checkGeofence(loin, { ...cegetel });
    expect(res!.withinRange).toBe(false);
    // Le résultat reste informatif : c'est l'appelant qui décide, et il
    // enregistre le pointage malgré tout.
    expect(res!.distanceMeters).toBeGreaterThan(GEOFENCE_TOLERANCE_M);
  });
});
