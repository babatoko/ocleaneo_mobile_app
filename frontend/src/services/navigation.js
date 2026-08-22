import { Capacitor } from '@capacitor/core';

/**
 * URL de guidage (pas juste une recherche sur une carte) : Apple Plans sur
 * iOS, Google Maps sinon. Des liens https:// standards (Universal/App Links)
 * plutôt qu'un schéma personnalisé — ouvrent l'app native si installée,
 * sinon fonctionnent quand même dans le navigateur.
 */
export function turnByTurnHref({ latitude, longitude, address }) {
  if (latitude && longitude) {
    if (Capacitor.getPlatform() === 'ios') {
      return `https://maps.apple.com/?daddr=${latitude},${longitude}&dirflg=d`;
    }
    return `https://www.google.com/maps/dir/?api=1&destination=${latitude},${longitude}&travelmode=driving`;
  }
  // Pas de coordonnées connues : repli sur une recherche par adresse.
  return `https://maps.google.com/?q=${encodeURIComponent(address || '')}`;
}
