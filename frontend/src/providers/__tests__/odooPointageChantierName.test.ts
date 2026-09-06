import { describe, expect, it, vi, beforeEach } from 'vitest';

/**
 * Un badge NFC dont la localisation ne matche aucun fsm.order ouvert
 * ("location-only clocking", voir pointage_with_tag.py côté backend) crée un
 * pointage sans fsm_order_id ni fsm_order_name — mais avec fsm_location_id/
 * fsm_location_name renseignés (le tag connaît toujours sa localisation).
 * OdooProvider doit retomber sur ce nom-là plutôt que de laisser chantier_name
 * vide, sans quoi PointageView n'a plus aucun nom de chantier à afficher.
 */

vi.mock('../odooClient', () => ({
  odooClient: { post: vi.fn() },
  ODOO_API_VERSION: 'v1',
  DEFAULT_ODOO_BASE_URL: 'http://x/api/mobile',
  getOdooBaseUrl: () => 'http://x/api/mobile',
  initOdooBaseUrl: vi.fn(),
  setOdooBaseUrl: vi.fn(),
}));

vi.mock('@capacitor/preferences', () => ({
  Preferences: { get: async () => ({ value: null }), set: async () => {} },
}));

const { odooClient } = await import('../odooClient');
const { OdooProvider } = await import('../OdooProvider');

const post = vi.mocked(odooClient.post);

beforeEach(() => {
  post.mockReset();
});

function mineResponse(entries: Record<string, unknown>[]) {
  return { data: { result: { date_from: '2026-09-06', date_to: '2026-09-06', count: entries.length, truncated: false, entries } } };
}

describe('OdooProvider.fetchTodayTimeEntries — nom du chantier', () => {
  it('utilise fsm_order_name quand il est présent', async () => {
    post.mockResolvedValueOnce(
      mineResponse([{
        id: 1, type: 'arrivee', datetime: '2026-09-06T07:00:00',
        fsm_order_id: 42, fsm_order_name: 'Résidence Bellevue — Bât. C',
        fsm_location_id: 7, fsm_location_name: 'Résidence Bellevue',
        client_ref: 'ref-1',
      }]),
    );

    const { entries } = await new OdooProvider().fetchTodayTimeEntries();

    expect(entries[0].chantier_name).toBe('Résidence Bellevue — Bât. C');
  });

  it("retombe sur fsm_location_name quand fsm_order_name est absent (pointage sans fsm.order matché)", async () => {
    post.mockResolvedValueOnce(
      mineResponse([{
        id: 2, type: 'arrivee', datetime: '2026-09-06T07:00:00',
        fsm_order_id: false, fsm_order_name: false,
        fsm_location_id: 7, fsm_location_name: 'Cegetel Macon',
        client_ref: 'ref-2',
      }]),
    );

    const { entries } = await new OdooProvider().fetchTodayTimeEntries();

    expect(entries[0].chantier_name).toBe('Cegetel Macon');
  });

  it("laisse chantier_name indéfini quand ni l'un ni l'autre n'est renseigné", async () => {
    post.mockResolvedValueOnce(
      mineResponse([{
        id: 3, type: 'arrivee', datetime: '2026-09-06T07:00:00',
        fsm_order_id: false, fsm_order_name: false,
        fsm_location_id: false, fsm_location_name: false,
        client_ref: 'ref-3',
      }]),
    );

    const { entries } = await new OdooProvider().fetchTodayTimeEntries();

    expect(entries[0].chantier_name).toBeUndefined();
  });
});
