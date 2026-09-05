import { describe, expect, it, vi, beforeEach } from 'vitest';

/**
 * ocleaneo#12 (backend) donnait à /planning un champ `status` pour
 * distinguer confirmé/terminé/annulé, mais tant que le backend ne l'envoyait
 * pas et excluait encore les commandes clôturées de sa réponse, ce mapping
 * restait du code mort : une vacation terminée ne devenait jamais 'done',
 * elle disparaissait purement et simplement de /planning (voir
 * ocleaneo_mobile_api_planning/controllers/planning.py, `_order_status()`,
 * et le repli 'confirmed' de planningOrderToShift() ci-dessous). Ce test
 * verrouille que le Shift porte bien le statut renvoyé par le backend —
 * dont dépendent aussi bien le badge Semaine/Jour que le filtre Tournée
 * (PlanningView.vue: `dayShifts.filter((s) => s.status !== 'done' && ...)`).
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

function planningResponse(order: Record<string, unknown>) {
  return {
    data: {
      result: {
        date: '2026-09-04',
        date_from: '2026-09-04',
        date_to: '2026-09-04',
        view: 'day',
        count: 1,
        truncated: false,
        orders: [order],
      },
    },
  };
}

const BASE_ORDER = {
  id: 42,
  name: 'WO0042',
  person_id: 7,
  scheduled_date_start: '2026-09-04T06:00:00',
  scheduled_date_end: '2026-09-04T08:30:00',
  date_start: false,
  date_end: false,
  instructions: false,
  activities: [],
  location: {
    name: 'Réserve la Truchère',
    street: '6 rue Greuze',
    city: 'Mâcon',
  },
};

describe('OdooProvider.fetchShifts — statut de la vacation', () => {
  it.each(['confirmed', 'partial', 'done', 'cancelled'] as const)(
    "reporte status: '%s' du backend sur le Shift",
    async (status) => {
      post.mockResolvedValueOnce(planningResponse({ ...BASE_ORDER, status }));

      const [shift] = await new OdooProvider().fetchShifts({ from: '2026-09-04', to: '2026-09-04' });

      expect(shift.status).toBe(status);
    },
  );

  it("retombe sur 'confirmed' quand le backend n'envoie pas encore status (déploiement en retard)", async () => {
    const { status: _status, ...orderWithoutStatus } = BASE_ORDER as typeof BASE_ORDER & { status?: string };
    post.mockResolvedValueOnce(planningResponse(orderWithoutStatus));

    const [shift] = await new OdooProvider().fetchShifts({ from: '2026-09-04', to: '2026-09-04' });

    expect(shift.status).toBe('confirmed');
  });

  // fsm_order.update_completion_from_worked_time (module
  // ocleaneo_mobile_pointage) : le taux de réalisation n'existe qu'une fois
  // un départ pointé sur la commande — false côté backend tant que ce n'est
  // pas le cas, jamais 0 (0% serait un mensonge, pas une absence de donnée).
  it('reporte completion_ratio du backend sur le Shift', async () => {
    post.mockResolvedValueOnce(planningResponse({ ...BASE_ORDER, status: 'partial', completion_ratio: 0.5 }));

    const [shift] = await new OdooProvider().fetchShifts({ from: '2026-09-04', to: '2026-09-04' });

    expect(shift.completion_ratio).toBe(0.5);
  });

  it("retombe sur null quand completion_ratio est absent ou false (aucun départ pointé)", async () => {
    post.mockResolvedValueOnce(planningResponse({ ...BASE_ORDER, completion_ratio: false }));

    const [shift] = await new OdooProvider().fetchShifts({ from: '2026-09-04', to: '2026-09-04' });

    expect(shift.completion_ratio).toBeNull();
  });
});
