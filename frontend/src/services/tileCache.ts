/**
 * Cache Storage pour les tuiles de fond de carte (services/offlineTileLayer.ts).
 * Séparé de ce dernier pour rester testable sans dépendre de Leaflet, qui
 * touche `window` dès son import et casse donc sous l'environnement de test
 * (Node, sans DOM) — voir __tests__/tileCache.test.ts.
 */

const CACHE_NAME = 'ocleaneo-map-tiles';

/** Résout l'URL objet (blob:) d'une tuile, depuis le cache si déjà vue,
 *  sinon depuis le réseau (mise en cache au passage). Rejette sans nouvelle
 *  tentative réseau si ni l'un ni l'autre n'aboutit — hors ligne sur une
 *  zone jamais vue. */
export async function resolveTileSrc(url: string): Promise<string> {
  const cache = await caches.open(CACHE_NAME);
  let response = await cache.match(url);
  if (!response) {
    response = await fetch(url);
    if (response.ok) void cache.put(url, response.clone());
  }
  if (!response.ok) throw new Error(`tuile indisponible (${response.status})`);
  return URL.createObjectURL(await response.blob());
}
