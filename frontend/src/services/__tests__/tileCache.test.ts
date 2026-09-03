import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import { resolveTileSrc } from '../tileCache';

/**
 * Le fond de carte de la Tournée redemandait le réseau pour chaque tuile,
 * sans aucun repli hors ligne — contrairement à l'itinéraire et ses arrêts
 * (services/tripCache.ts, PR #62). resolveTileSrc() sert une tuile déjà vue
 * depuis le Cache Storage du navigateur sans repasser par le réseau, et
 * échoue proprement (sans nouvelle tentative réseau) pour une tuile jamais
 * vue et indisponible hors ligne.
 */

function response(ok: boolean, status = 200): Response {
  return {
    ok,
    status,
    clone: () => response(ok, status),
    blob: async () => new Blob(['tuile']),
  } as unknown as Response;
}

const match = vi.fn();
const put = vi.fn();
const open = vi.fn(async () => ({ match, put }));
const fetchMock = vi.fn();
const createObjectURL = vi.fn(() => 'blob:mock-tile');

beforeEach(() => {
  match.mockReset();
  put.mockReset();
  open.mockClear();
  fetchMock.mockReset();
  createObjectURL.mockClear();
  vi.stubGlobal('caches', { open });
  vi.stubGlobal('fetch', fetchMock);
  vi.stubGlobal('URL', { createObjectURL });
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('resolveTileSrc', () => {
  it('sert une tuile déjà en cache sans repasser par le réseau', async () => {
    match.mockResolvedValue(response(true));

    const src = await resolveTileSrc('https://tile.example/1/2/3.png');

    expect(src).toBe('blob:mock-tile');
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('récupère et met en cache une tuile jamais vue (en ligne)', async () => {
    match.mockResolvedValue(undefined);
    fetchMock.mockResolvedValue(response(true));

    const src = await resolveTileSrc('https://tile.example/1/2/3.png');

    expect(src).toBe('blob:mock-tile');
    expect(put).toHaveBeenCalledWith('https://tile.example/1/2/3.png', expect.anything());
  });

  it("échoue sans mettre en cache une réponse serveur en erreur", async () => {
    match.mockResolvedValue(undefined);
    fetchMock.mockResolvedValue(response(false, 404));

    await expect(resolveTileSrc('https://tile.example/1/2/3.png')).rejects.toThrow('404');
    expect(put).not.toHaveBeenCalled();
  });

  it('échoue proprement hors ligne pour une tuile jamais vue', async () => {
    match.mockResolvedValue(undefined);
    fetchMock.mockRejectedValue(new TypeError('Failed to fetch'));

    await expect(resolveTileSrc('https://tile.example/1/2/3.png')).rejects.toThrow();
  });
});
