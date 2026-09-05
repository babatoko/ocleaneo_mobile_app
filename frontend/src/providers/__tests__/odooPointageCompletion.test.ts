import { describe, expect, it, vi, beforeEach } from 'vitest';

/**
 * OdooProvider.createTimeEntry() doit répercuter le verdict de complétion
 * renvoyé par POST /api/mobile/pointage sur un départ (voir
 * fsm_order.update_completion_from_worked_time côté Odoo, module
 * ocleaneo_mobile_pointage) — c'est ce que pointage.ts lit ensuite pour
 * savoir quel statut réel donner à la vacation (planning.markShiftDone),
 * au lieu de supposer "terminé" à chaque départ.
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

function pointageResponse(result: Record<string, unknown>) {
  return { data: { result } };
}

const BASE_PAYLOAD = {
  chantierId: 42,
  type: 'out' as const,
  recordedAt: '2026-09-04T08:00:00.000Z',
  clientRef: 'ref-1',
};

describe('OdooProvider.createTimeEntry — verdict de complétion sur un départ', () => {
  it.each([
    ['done', 'done'],
    ['partial', 'partial'],
    ['not_done', 'confirmed'],
  ] as const)("traduit completion_state '%s' en shift_status '%s'", async (completion_state, expected) => {
    post.mockResolvedValueOnce(
      pointageResponse({
        id: 1,
        type: 'depart',
        datetime: '2026-09-04T08:00:00',
        fsm_order_id: 42,
        completion_state,
        completion_ratio: 0.5,
      }),
    );

    const entry = await new OdooProvider().createTimeEntry(BASE_PAYLOAD);

    expect(entry.shift_status).toBe(expected);
    expect(entry.completion_ratio).toBe(0.5);
  });

  it("laisse shift_status indéfini quand completion_state est absent (backend pas encore mis à jour, ou pointage sans fsm_order_id)", async () => {
    post.mockResolvedValueOnce(
      pointageResponse({
        id: 1,
        type: 'arrivee',
        datetime: '2026-09-04T08:00:00',
        fsm_order_id: false,
      }),
    );

    const entry = await new OdooProvider().createTimeEntry({ ...BASE_PAYLOAD, type: 'in' });

    expect(entry.shift_status).toBeUndefined();
    expect(entry.completion_ratio).toBeNull();
  });
});
