import type * as Leaflet from 'leaflet';
import { resolveTileSrc } from './tileCache';

/**
 * Fond de carte (tuiles OSM) mis en cache au fil de la consultation, pour
 * que la carte de la Tournée reste utilisable hors ligne — jusqu'ici, seuls
 * l'itinéraire et ses arrêts retombaient sur un cache (services/tripCache.ts,
 * PR #62) ; le fond de carte lui-même redemandait le réseau à chaque tuile et
 * restait blanc hors ligne, y compris pour une zone déjà consultée en ligne
 * quelques minutes plus tôt.
 *
 * La logique de cache elle-même vit dans services/tileCache.ts, séparée
 * d'ici pour rester testable sans dépendre de Leaflet (qui touche `window`
 * dès son import et casse donc sous l'environnement de test, sans DOM).
 *
 * `import type` ci-dessus, jamais `import L from 'leaflet'` : PlanningView.vue
 * charge déjà Leaflet en dynamique (`await import('leaflet')`), uniquement à
 * l'ouverture de la Tournée, pour ne pas alourdir chaque visite du planning
 * de ses ~150 Ko. Un import statique ici aurait réintroduit ce poids sur
 * Jour/Semaine/Mois — c'est pourquoi createOfflineTileLayer() reçoit
 * l'instance L déjà chargée, au lieu d'importer le module elle-même.
 */
export function createOfflineTileLayer(L: typeof Leaflet): typeof Leaflet.TileLayer {
  // L.TileLayer.extend() est le mécanisme d'héritage propre à Leaflet (pas
  // `class X extends Y` de TS) — c'est ce qui permet d'appeler
  // this._tileOnLoad / this._tileOnError ci-dessous exactement comme le
  // ferait l'implémentation d'origine, pour conserver tout l'état interne de
  // Leaflet (animation de fondu, compteur de tuiles en cours de chargement,
  // événement 'load' de la couche) plutôt que de le réinventer.
  //
  // Le typage de L.Class.extend() ne reporte que le constructeur de Class
  // elle-même (0 argument), pas celui, plus spécifique, de TileLayer(url,
  // options) qu'on hérite pourtant bien à l'exécution — d'où le cast final,
  // qui ne fait que rendre explicite une signature déjà vraie en pratique.
  return L.TileLayer.extend({
    createTile(this: Leaflet.TileLayer, coords: Leaflet.Coords, done: Leaflet.DoneCallback): HTMLElement {
      const tile = document.createElement('img');
      tile.alt = '';
      tile.setAttribute('role', 'presentation');

      const url = this.getTileUrl(coords);

      if (typeof caches === 'undefined') {
        // Cache Storage indisponible (très vieille WebView, environnement de
        // test) : repli direct sur le chargement natif, sans mise en cache.
        L.DomEvent.on(tile, 'load', L.bind((this as unknown as Record<string, unknown>)._tileOnLoad as (...a: unknown[]) => void, this, done, tile));
        L.DomEvent.on(tile, 'error', L.bind((this as unknown as Record<string, unknown>)._tileOnError as (...a: unknown[]) => void, this, done, tile));
        tile.src = url;
        return tile;
      }

      const self = this as unknown as {
        _tileOnLoad: (done: Leaflet.DoneCallback, tile: HTMLElement) => void;
        _tileOnError: (done: Leaflet.DoneCallback, tile: HTMLElement, e: Error) => void;
      };

      resolveTileSrc(url)
        .then((objectUrl) => {
          L.DomEvent.on(tile, 'load', () => self._tileOnLoad(done, tile));
          L.DomEvent.on(tile, 'error', () => self._tileOnError(done, tile, new Error('tuile indisponible')));
          tile.src = objectUrl;
        })
        .catch(() => {
          // Ni en cache, ni joignable : hors ligne sur une zone jamais vue.
          // Pas de nouvelle tentative réseau (elle échouerait de la même
          // façon) — on signale directement l'échec à Leaflet.
          self._tileOnError(done, tile, new Error('tuile indisponible hors ligne'));
        });

      return tile;
    },
  }) as unknown as typeof Leaflet.TileLayer;
}
