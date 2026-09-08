import { describe, expect, it, vi, beforeEach } from 'vitest';

/**
 * Le endpoint /pointage/sync retourne l'état serveur d'un ouvrier. Le provider
 * doit l'appeler avec include_attendance / include_timesheet, mapper les
 * pointages, présences et lignes de temps, et transmettre serverTime.
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

function syncResponse(payload: Record<string, unknown>) {
  return { data: { result: payload } };
}

describe('OdooProvider.syncPointageState', () => {
  it('appelle /pointage/sync avec la bonne plage et les flags attendus', async () => {
    post.mockResolvedValueOnce(syncResponse({
      server_time: '2026-09-08T19:00:00',
      count: 0,
      entries: [],
      attendances: [],
      timesheets: [],
    }));

    await new OdooProvider().syncPointageState({ from: '2026-09-08', to: '2026-09-08' });

    expect(post).toHaveBeenCalledWith('/v1/pointage/sync', expect.objectContaining({
      jsonrpc: '2.0',
      method: 'call',
      params: expect.objectContaining({
        date_from: '2026-09-08',
        date_to: '2026-09-08',
        include_attendance: true,
        include_timesheet: true,
      }),
    }));
  });

  it('mappe les entrées, présences et timesheets', async () => {
    post.mockResolvedValueOnce(syncResponse({
      server_time: '2026-09-08T19:00:00',
      count: 2,
      entries: [
        { id: 1, type: 'arrivee', datetime: '2026-09-08T07:00:00', fsm_order_id: 42, client_ref: 'ref-1' },
        { id: 2, type: 'depart', datetime: '2026-09-08T11:00:00', fsm_order_id: 42, client_ref: 'ref-2', completion_state: 'done' },
      ],
      attendances: [{ id: 10, check_in: '2026-09-08T07:00:00', check_out: '2026-09-08T11:00:00' }],
      timesheets: [{ id: 20, date_time: '2026-09-08T07:00:00', date_time_end: '2026-09-08T11:00:00', unit_amount: 4 }],
    }));

    const result = await new OdooProvider().syncPointageState({ from: '2026-09-08', to: '2026-09-08' });

    expect(result.serverTime).toBe('2026-09-08T19:00:00');
    expect(result.entries).toHaveLength(2);
    expect(result.entries[0].type).toBe('in');
    expect(result.entries[1].type).toBe('out');
    expect(result.attendances).toHaveLength(1);
    expect(result.timesheets).toHaveLength(1);
    expect(result.entries[1].shift_status).toBe('done');
  });
});
