import { DataProvider } from './DataProvider';

const employee = { id: 1, name: 'Sophie Martin' };

const chantiers = [
  {
    id: 1,
    name: 'Cegetel Macon',
    address: '12 rue des Frères Lumière, Mâcon',
    is_active: 1,
    nfc_tag_id: '04A1B2C3',
    latitude: 46.3069,
    longitude: 4.8285,
  },
  {
    id: 2,
    name: 'Résidence Les Tilleuls',
    address: 'Tournus',
    is_active: 1,
    nfc_tag_id: '04D4E5F6',
    latitude: 46.568,
    longitude: 4.906,
  },
];

const products = [
  { id: 1, name: 'Javel', emoji: '🧴', category: 'Sol', is_active: 1, packagings: [{ id: 1, label: '5L', is_default: true }] },
  { id: 2, name: 'Dégraissant sol', emoji: '🧹', category: 'Sol', is_active: 1, packagings: [{ id: 2, label: '5L', is_default: true }] },
  { id: 3, name: 'Spray vitres', emoji: '🪟', category: 'Vitres', is_active: 1, packagings: [{ id: 3, label: '750ml', is_default: true }] },
  { id: 4, name: 'Papier toilette', emoji: '🧻', category: 'Consommables', is_active: 1, packagings: [{ id: 4, label: 'Carton 96 rouleaux', is_default: true }] },
];

function todayIso() {
  return new Date().toISOString().slice(0, 10);
}

function shiftsFixture() {
  const today = todayIso();
  return [
    {
      id: 1,
      employee_id: 1,
      chantier_id: 1,
      chantier_name: chantiers[0].name,
      chantier_address: chantiers[0].address,
      start_at: `${today}T08:00:00`,
      end_at: `${today}T11:00:00`,
      status: 'confirmed',
      note: null,
    },
    {
      id: 2,
      employee_id: 1,
      chantier_id: 2,
      chantier_name: chantiers[1].name,
      chantier_address: chantiers[1].address,
      start_at: `${today}T14:00:00`,
      end_at: `${today}T16:30:00`,
      status: 'confirmed',
      note: null,
    },
  ];
}

function delay(ms = 150) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

let timeEntries = [];
let orders = [];
let inventoryByChantier = {};
let nextEntryId = 1;
let nextOrderId = 1;

/**
 * Provider 100 % en mémoire, aucun appel réseau : pour développer ou faire
 * une démo de l'app sans backend Odoo branché. Sert aussi de preuve que le
 * contrat DataProvider est complet — si l'app tourne de bout en bout dessus,
 * n'importe quel backend qui l'implémente le fera aussi. Activé via
 * VITE_DATA_PROVIDER=mock (voir providers/index.js). L'état est perdu au
 * rechargement de la page (mémoire du module JS, pas de persistance).
 */
export class MockProvider extends DataProvider {
  async login(username) {
    await delay();
    return { token: 'mock-token', employee: { ...employee, name: username || employee.name } };
  }

  async fetchMe() {
    await delay();
    return employee;
  }

  async fetchChantiers() {
    await delay();
    return chantiers;
  }

  async fetchShifts({ from, to }) {
    await delay();
    return shiftsFixture().filter((s) => {
      const day = s.start_at.slice(0, 10);
      return day >= from && day <= to;
    });
  }

  async fetchTodayTimeEntries() {
    await delay();
    const today = todayIso();
    const entries = timeEntries.filter((e) => e.recorded_at.startsWith(today));
    const last = entries[entries.length - 1];
    const status = !last ? 'out' : last.type === 'pause_start' ? 'paused' : last.type === 'pause_end' ? 'in' : last.type;
    return { entries, status };
  }

  async fetchTimeEntries({ from, to }) {
    await delay();
    return timeEntries.filter((e) => {
      const day = e.recorded_at.slice(0, 10);
      return day >= from && day <= to;
    });
  }

  async createTimeEntry(payload) {
    await delay();
    const chantier = chantiers.find((c) => c.id === payload.chantierId);
    const entry = {
      id: nextEntryId++,
      type: payload.type,
      chantier_id: payload.chantierId,
      chantier_name: chantier?.name || '',
      recorded_at: payload.recordedAt || new Date().toISOString(),
    };
    timeEntries.push(entry);
    return entry;
  }

  async fetchProducts() {
    await delay();
    return products;
  }

  async fetchInventoryLatest(chantierId) {
    await delay();
    return inventoryByChantier[chantierId] || null;
  }

  async submitInventory({ chantierId, items }) {
    await delay();
    inventoryByChantier[chantierId] = {
      items: items.map((i) => ({
        product_id: i.productId,
        packaging_id: i.packagingId,
        quantity_remaining: i.quantityRemaining,
      })),
    };
  }

  async createOrder({ chantierId, items }) {
    await delay();
    const chantier = chantiers.find((c) => c.id === chantierId);
    const order = {
      id: nextOrderId++,
      chantier_name: chantier?.name || '',
      status: 'confirmed',
      created_at: new Date().toISOString(),
      items: items.map((i) => {
        const product = products.find((p) => p.id === i.productId);
        const pkg = product?.packagings.find((pk) => pk.id === i.packagingId);
        return {
          id: i.productId,
          product_emoji: product?.emoji,
          product_name: product?.name,
          packaging_label: pkg?.label,
          quantity: i.quantity,
        };
      }),
    };
    orders.unshift(order);
    return { id: order.id };
  }

  async fetchOrder(id) {
    await delay();
    return orders.find((o) => String(o.id) === String(id)) || null;
  }

  async fetchMyOrders() {
    await delay();
    return orders;
  }

  getOrderPdfUrl() {
    return null; // pas de génération de PDF côté mock
  }
}
