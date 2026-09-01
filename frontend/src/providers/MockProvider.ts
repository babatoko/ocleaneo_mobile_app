import { DataProvider } from './DataProvider';
import { addDaysIso, todayIso } from '../utils/date';
import { startOfWeekIso } from '../utils/week';
import type {
  Chantier,
  CreateOrderPayload,
  CreateOrderResult,
  CreateTimeEntryPayload,
  DateRange,
  Employee,
  InventoryLatest,
  LoginResult,
  Order,
  Product,
  Shift,
  SubmitInventoryPayload,
  TimeEntry,
  TodayTimeEntries,
} from '../types/models';

const employee: Employee = { id: 1, name: 'Sophie Martin' };

const chantiers: Chantier[] = [
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
    address: '8 rue des Tilleuls, Tournus',
    is_active: 1,
    nfc_tag_id: '04D4E5F6',
    latitude: 46.568,
    longitude: 4.906,
  },
  {
    id: 3,
    name: 'Clinique du Val de Saône',
    address: '22 quai Bouchacourt, Mâcon',
    is_active: 1,
    nfc_tag_id: '04B7C8D9',
    latitude: 46.3057,
    longitude: 4.8319,
  },
  {
    id: 4,
    name: 'Collège Lamartine',
    address: '5 rue Lamartine, Mâcon',
    is_active: 1,
    nfc_tag_id: '04E1F2A3',
    latitude: 46.3082,
    longitude: 4.8301,
  },
];

const products: Product[] = [
  { id: 1, name: 'Javel', emoji: '🧴', category: 'Sol', is_active: 1, packagings: [{ id: 1, label: '5L', is_default: true }] },
  { id: 2, name: 'Dégraissant sol', emoji: '🧹', category: 'Sol', is_active: 1, packagings: [{ id: 2, label: '5L', is_default: true }] },
  { id: 3, name: 'Spray vitres', emoji: '🪟', category: 'Vitres', is_active: 1, packagings: [{ id: 3, label: '750ml', is_default: true }] },
  { id: 4, name: 'Papier toilette', emoji: '🧻', category: 'Consommables', is_active: 1, packagings: [{ id: 4, label: 'Carton 96 rouleaux', is_default: true }] },
  { id: 5, name: 'Essuie-mains', emoji: '🧻', category: 'Consommables', is_active: 1, packagings: [{ id: 5, label: 'Carton 6 rouleaux', is_default: true }] },
  { id: 6, name: 'Savon mains', emoji: '🧼', category: 'Sanitaires', is_active: 1, packagings: [{ id: 6, label: '500ml', is_default: true }] },
  { id: 7, name: 'Désinfectant sanitaires', emoji: '🧽', category: 'Sanitaires', is_active: 1, packagings: [{ id: 7, label: '1L', is_default: true }] },
  { id: 8, name: 'Sacs poubelle 50L', emoji: '🗑️', category: 'Consommables', is_active: 1, packagings: [{ id: 8, label: 'Rouleau de 20', is_default: true }] },
];

/**
 * Vacations réparties sur toute la semaine calendaire en cours (lundi-dimanche
 * de `today`) pour que Semaine/Mois affichent plusieurs jours renseignés, pas
 * seulement aujourd'hui — plus les deux vacations du jour même de la fixture
 * d'origine, ancrées sur `today` plutôt que sur un jour fixe de la semaine
 * pour que l'onglet Jour et la Tournée aient toujours des données quel que
 * soit le jour d'exécution.
 */
function shiftsFixture(): Shift[] {
  const today = todayIso();
  const monday = startOfWeekIso(today);
  const weekday = (n: number) => addDaysIso(monday, n);

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
      note: 'Digicode 4471B — sonner à l\'accueil si besoin.',
      instructions: 'Ne pas utiliser de produit à javel sur le sol en marbre du hall. Sortir les poubelles avant 17h (collecte le mardi).',
      activities: [
        { id: 1, name: 'Aspirer les parties communes', required: true, completed: false },
        { id: 2, name: 'Nettoyer les vitres du hall', required: true, completed: false },
        { id: 3, name: 'Sortir les poubelles', required: false, completed: false },
      ],
    },
    {
      id: 3,
      employee_id: 1,
      chantier_id: 4,
      chantier_name: chantiers[3].name,
      chantier_address: chantiers[3].address,
      start_at: `${today}T06:00:00`,
      end_at: `${today}T07:00:00`,
      // Terminée : un départ badgé plus tôt ce matin a déjà clôturé le WO
      // (voir ocleaneo#11/#12) — sert d'exemple pour le rendu grisé/"terminé".
      status: 'done',
      note: null,
    },
    // Lundi
    {
      id: 4,
      employee_id: 1,
      chantier_id: 1,
      chantier_name: chantiers[0].name,
      chantier_address: chantiers[0].address,
      start_at: `${weekday(0)}T08:00:00`,
      end_at: `${weekday(0)}T11:00:00`,
      status: 'confirmed',
      note: null,
    },
    // Mercredi
    {
      id: 5,
      employee_id: 1,
      chantier_id: 3,
      chantier_name: chantiers[2].name,
      chantier_address: chantiers[2].address,
      start_at: `${weekday(2)}T07:30:00`,
      end_at: `${weekday(2)}T10:00:00`,
      status: 'confirmed',
      note: 'Client absent — prévenir la réception avant d\'entrer.',
    },
    // Jeudi
    {
      id: 6,
      employee_id: 1,
      chantier_id: 1,
      chantier_name: chantiers[0].name,
      chantier_address: chantiers[0].address,
      start_at: `${weekday(3)}T08:00:00`,
      end_at: `${weekday(3)}T11:00:00`,
      status: 'modified',
      note: null,
    },
    {
      id: 7,
      employee_id: 1,
      chantier_id: 4,
      chantier_name: chantiers[3].name,
      chantier_address: chantiers[3].address,
      start_at: `${weekday(3)}T13:00:00`,
      end_at: `${weekday(3)}T15:00:00`,
      status: 'confirmed',
      note: null,
    },
    // Vendredi
    {
      id: 8,
      employee_id: 1,
      chantier_id: 2,
      chantier_name: chantiers[1].name,
      chantier_address: chantiers[1].address,
      start_at: `${weekday(4)}T09:00:00`,
      end_at: `${weekday(4)}T12:00:00`,
      status: 'confirmed',
      note: null,
    },
    {
      id: 9,
      employee_id: 1,
      chantier_id: 3,
      chantier_name: chantiers[2].name,
      chantier_address: chantiers[2].address,
      start_at: `${weekday(4)}T15:00:00`,
      end_at: `${weekday(4)}T17:00:00`,
      status: 'confirmed',
      note: null,
    },
  ];
}

function delay(ms = 150): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Historique de pointage sur les deux jours précédents (arrivée/pause/reprise/
 * départ) pour que Pointage/Historique ne parte pas d'un écran vide — les
 * pointages du jour même restent, eux, à saisir en direct dans la démo.
 */
function timeEntriesFixture(): TimeEntry[] {
  const yesterday = addDaysIso(todayIso(), -1);
  const beforeYesterday = addDaysIso(todayIso(), -2);
  return [
    { id: 1, type: 'in', chantier_id: 1, chantier_name: chantiers[0].name, recorded_at: `${beforeYesterday}T08:02:00` },
    { id: 2, type: 'out', chantier_id: 1, chantier_name: chantiers[0].name, recorded_at: `${beforeYesterday}T11:05:00` },
    { id: 3, type: 'in', chantier_id: 2, chantier_name: chantiers[1].name, recorded_at: `${beforeYesterday}T14:00:00` },
    { id: 4, type: 'out', chantier_id: 2, chantier_name: chantiers[1].name, recorded_at: `${beforeYesterday}T16:28:00` },
    { id: 5, type: 'in', chantier_id: 1, chantier_name: chantiers[0].name, recorded_at: `${yesterday}T07:58:00` },
    { id: 6, type: 'pause_start', chantier_id: 1, chantier_name: chantiers[0].name, recorded_at: `${yesterday}T09:30:00` },
    { id: 7, type: 'pause_end', chantier_id: 1, chantier_name: chantiers[0].name, recorded_at: `${yesterday}T09:45:00` },
    { id: 8, type: 'out', chantier_id: 1, chantier_name: chantiers[0].name, recorded_at: `${yesterday}T11:10:00` },
  ];
}

/** Deux commandes passées les jours précédents, pour que l'historique et le
 *  récapitulatif aient un vrai contenu à afficher. */
function ordersFixture(): Order[] {
  const yesterday = addDaysIso(todayIso(), -1);
  const beforeYesterday = addDaysIso(todayIso(), -3);
  return [
    {
      id: 2,
      chantier_name: chantiers[0].name,
      status: 'confirmed',
      created_at: `${yesterday}T11:20:00`,
      items: [
        { id: 1, product_emoji: '🧴', product_name: 'Javel', packaging_label: '5L', quantity: 2 },
        { id: 6, product_emoji: '🧼', product_name: 'Savon mains', packaging_label: '500ml', quantity: 3 },
      ],
    },
    {
      id: 1,
      chantier_name: chantiers[1].name,
      status: 'confirmed',
      created_at: `${beforeYesterday}T16:40:00`,
      items: [
        { id: 4, product_emoji: '🧻', product_name: 'Papier toilette', packaging_label: 'Carton 96 rouleaux', quantity: 1 },
        { id: 3, product_emoji: '🪟', product_name: 'Spray vitres', packaging_label: '750ml', quantity: 2 },
      ],
    },
  ];
}

/** Niveaux de stock initiaux pour Cegetel Mâcon — de quoi voir les trois
 *  statuts (OK/faible/rupture) sur l'écran Catalogue dès l'ouverture. */
function inventoryFixture(): Record<number, InventoryLatest> {
  return {
    1: {
      items: [
        { product_id: 1, packaging_id: 1, quantity_remaining: 4 },
        { product_id: 2, packaging_id: 2, quantity_remaining: 1 },
        { product_id: 3, packaging_id: 3, quantity_remaining: 0 },
        { product_id: 4, packaging_id: 4, quantity_remaining: 6 },
        { product_id: 5, packaging_id: 5, quantity_remaining: 2 },
        { product_id: 6, packaging_id: 6, quantity_remaining: 5 },
        { product_id: 7, packaging_id: 7, quantity_remaining: 1 },
        { product_id: 8, packaging_id: 8, quantity_remaining: 3 },
      ],
    },
  };
}

const timeEntries: TimeEntry[] = timeEntriesFixture();
const orders: Order[] = ordersFixture();
const inventoryByChantier: Record<number, InventoryLatest> = inventoryFixture();
let nextEntryId = timeEntries.length + 1;
let nextOrderId = orders.length + 1;

/**
 * Provider 100 % en mémoire, aucun appel réseau : pour développer ou faire
 * une démo de l'app sans backend Odoo branché. Sert aussi de preuve que le
 * contrat DataProvider est complet — si l'app tourne de bout en bout dessus,
 * n'importe quel backend qui l'implémente le fera aussi. Activé via
 * VITE_DATA_PROVIDER=mock (voir providers/index.ts). L'état est perdu au
 * rechargement de la page (mémoire du module JS, pas de persistance).
 */
export class MockProvider extends DataProvider {
  async login(username: string): Promise<LoginResult> {
    await delay();
    return { token: 'mock-token', employee: { ...employee, name: username || employee.name } };
  }

  async fetchMe(): Promise<Employee> {
    await delay();
    return employee;
  }

  async fetchChantiers(): Promise<Chantier[]> {
    await delay();
    return chantiers;
  }

  async fetchShifts({ from, to }: DateRange): Promise<Shift[]> {
    await delay();
    return shiftsFixture().filter((s) => {
      const day = s.start_at.slice(0, 10);
      return day >= from && day <= to;
    });
  }

  async fetchTodayTimeEntries(): Promise<TodayTimeEntries> {
    await delay();
    const today = todayIso();
    const entries = timeEntries.filter((e) => e.recorded_at.startsWith(today));
    const last = entries[entries.length - 1];
    const status = !last ? 'out' : last.type === 'pause_start' ? 'paused' : last.type === 'pause_end' ? 'in' : last.type;
    return { entries, status };
  }

  async fetchTimeEntries({ from, to }: DateRange): Promise<TimeEntry[]> {
    await delay();
    return timeEntries.filter((e) => {
      const day = e.recorded_at.slice(0, 10);
      return day >= from && day <= to;
    });
  }

  async createTimeEntry(payload: CreateTimeEntryPayload): Promise<TimeEntry> {
    await delay();
    // Preuve que le contrat tient : un rejeu (même clientRef, ex. après une
    // réponse perdue puis un pointage remis en file hors ligne) renvoie
    // l'entrée déjà créée plutôt que d'en créer une deuxième — exactement ce
    // qu'un backend réel doit faire avec cette clé (voir README § Contrat Odoo).
    const existing = timeEntries.find((e) => e.client_ref === payload.clientRef);
    if (existing) return existing;

    const chantier = chantiers.find((c) => c.id === payload.chantierId);
    const entry: TimeEntry = {
      id: nextEntryId++,
      type: payload.type,
      chantier_id: payload.chantierId,
      chantier_name: chantier?.name || '',
      recorded_at: payload.recordedAt || new Date().toISOString(),
      client_ref: payload.clientRef,
    };
    timeEntries.push(entry);
    return entry;
  }

  async fetchProducts(): Promise<Product[]> {
    await delay();
    return products;
  }

  async fetchInventoryLatest(chantierId: number): Promise<InventoryLatest | null> {
    await delay();
    return inventoryByChantier[chantierId] || null;
  }

  async submitInventory({ chantierId, items }: SubmitInventoryPayload): Promise<void> {
    await delay();
    inventoryByChantier[chantierId] = {
      items: items.map((i) => ({
        product_id: i.productId,
        packaging_id: i.packagingId,
        quantity_remaining: i.quantityRemaining,
      })),
    };
  }

  async createOrder({ chantierId, items }: CreateOrderPayload): Promise<CreateOrderResult> {
    await delay();
    const chantier = chantiers.find((c) => c.id === chantierId);
    const order: Order = {
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

  async fetchOrder(id: number | string): Promise<Order | null> {
    await delay();
    return orders.find((o) => String(o.id) === String(id)) || null;
  }

  async fetchMyOrders(): Promise<Order[]> {
    await delay();
    return orders;
  }

  getOrderPdfUrl(): null {
    return null; // pas de génération de PDF côté mock
  }
}
