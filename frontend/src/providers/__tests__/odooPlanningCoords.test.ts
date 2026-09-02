import { describe, expect, it, vi, beforeEach } from 'vitest';

/**
 * Un salarié voyait la Tournée refuser de se calculer ("coordonnées GPS
 * manquantes") pour des chantiers qui en ont pourtant bien dans Odoo.
 * Cause : PlanningView.vue recoupait chaque shift avec chantiers.list
 * (/chantiers/aujourdhui), une liste plafonnée à 50 commandes triée en
 * priorisant celles du jour du serveur — un jour consulté à l'avance (ou un
 * salarié avec beaucoup de commandes ouvertes) pouvait n'y trouver aucun de
 * ses chantiers. /planning renvoie pourtant déjà les coordonnées par
 * commande (location.latitude/longitude côté contrôleur Python) ; ce test
 * verrouille qu'OdooProvider les fait bien remonter jusqu'au Shift, pour
 * que PlanningView puisse les lire directement sans ce second appel.
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
  status: 'confirmed',
  instructions: false,
  activities: [],
  location: {
    name: 'Réserve la Truchère',
    street: '6 rue Greuze',
    city: 'Mâcon',
  },
};

describe('OdooProvider.fetchShifts — coordonnées du chantier', () => {
  it('reporte latitude/longitude sur le Shift quand /planning les renvoie', async () => {
    post.mockResolvedValueOnce(
      planningResponse({ ...BASE_ORDER, location: { ...BASE_ORDER.location, latitude: 46.3069, longitude: 4.8285 } }),
    );

    const [shift] = await new OdooProvider().fetchShifts({ from: '2026-09-04', to: '2026-09-04' });

    expect(shift.latitude).toBe(46.3069);
    expect(shift.longitude).toBe(4.8285);
  });

  it('reste null (pas manquant à tort) quand le chantier n\'a réellement pas de coordonnées', async () => {
    post.mockResolvedValueOnce(
      planningResponse({ ...BASE_ORDER, location: { ...BASE_ORDER.location, latitude: false, longitude: false } }),
    );

    const [shift] = await new OdooProvider().fetchShifts({ from: '2026-09-04', to: '2026-09-04' });

    expect(shift.latitude).toBeNull();
    expect(shift.longitude).toBeNull();
  });
});
