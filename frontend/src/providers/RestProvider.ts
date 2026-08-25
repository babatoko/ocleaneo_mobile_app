import { DEFAULT_BASE_URL, getApiBaseUrl, initApiBaseUrl, restClient, setApiBaseUrl } from './restClient';
import { DataProvider, ProviderError, ProviderNetworkError } from './DataProvider';
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
  SubmitInventoryPayload,
  Shift,
  TimeEntry,
  TodayTimeEntries,
} from '../types/models';

// On distingue par la forme (duck typing) plutôt que par `instanceof
// AxiosError` : c'est la forme de la réponse HTTP qui fait foi, pas la classe
// exacte qui l'a portée jusqu'ici (utile aussi pour les tests, qui simulent
// un rejet axios sans construire une vraie AxiosError).
interface AxiosLikeError {
  response?: { status: number; data?: { error?: string } };
  message?: string;
}

function isAxiosLikeError(e: unknown): e is AxiosLikeError {
  return typeof e === 'object' && e !== null && ('response' in e || 'message' in e);
}

function normalizeError(e: unknown): Error {
  if (!isAxiosLikeError(e) || !e.response) return new ProviderNetworkError();
  const message = e.response.data?.error || e.message || 'Erreur serveur.';
  return new ProviderError(message, e.response.status);
}

/**
 * Implémentation REST du contrat DataProvider — le "plugin" branché par
 * défaut, pensé pour parler à une couche `base_rest` Odoo (voir README
 * § Intégration Odoo). Toute la connaissance du protocole HTTP/JSON et des
 * chemins d'URL vit ici ; rien de ça ne doit fuiter vers les stores/vues.
 */
export class RestProvider extends DataProvider {
  async init(): Promise<void> {
    await initApiBaseUrl();
  }

  getServerUrl(): string | null {
    return getApiBaseUrl() ?? null;
  }

  getDefaultServerUrl(): string {
    return DEFAULT_BASE_URL;
  }

  async setServerUrl(url: string): Promise<void> {
    await setApiBaseUrl(url);
  }

  async login(username: string, password: string): Promise<LoginResult> {
    try {
      const { data } = await restClient.post<LoginResult>('/auth/login', { username, password });
      return data;
    } catch (e) {
      throw normalizeError(e);
    }
  }

  async fetchMe(): Promise<Employee> {
    try {
      const { data } = await restClient.get<Employee>('/auth/me');
      return data;
    } catch (e) {
      throw normalizeError(e);
    }
  }

  async fetchChantiers(): Promise<Chantier[]> {
    try {
      const { data } = await restClient.get<Chantier[]>('/chantiers/mine');
      return data;
    } catch (e) {
      throw normalizeError(e);
    }
  }

  async fetchShifts({ from, to }: DateRange): Promise<Shift[]> {
    try {
      const { data } = await restClient.get<Shift[]>('/shifts/mine', { params: { from, to } });
      return data;
    } catch (e) {
      throw normalizeError(e);
    }
  }

  async fetchTodayTimeEntries(): Promise<TodayTimeEntries> {
    try {
      const { data } = await restClient.get<TodayTimeEntries>('/time-entries/today');
      return data;
    } catch (e) {
      throw normalizeError(e);
    }
  }

  async fetchTimeEntries({ from, to }: DateRange): Promise<TimeEntry[]> {
    try {
      const { data } = await restClient.get<TimeEntry[]>('/time-entries/mine', { params: { from, to } });
      return data;
    } catch (e) {
      throw normalizeError(e);
    }
  }

  async createTimeEntry(payload: CreateTimeEntryPayload): Promise<TimeEntry> {
    try {
      const { data } = await restClient.post<TimeEntry>('/time-entries', payload);
      return data;
    } catch (e) {
      throw normalizeError(e);
    }
  }

  async fetchProducts(): Promise<Product[]> {
    try {
      const { data } = await restClient.get<Product[]>('/products');
      return data;
    } catch (e) {
      throw normalizeError(e);
    }
  }

  async fetchInventoryLatest(chantierId: number): Promise<InventoryLatest | null> {
    try {
      const { data } = await restClient.get<InventoryLatest>(`/inventory/chantier/${chantierId}/latest`);
      return data;
    } catch (e) {
      if (isAxiosLikeError(e) && e.response?.status === 404) return null; // pas d'inventaire enregistré, pas une erreur
      throw normalizeError(e);
    }
  }

  async submitInventory(payload: SubmitInventoryPayload): Promise<void> {
    try {
      await restClient.post('/inventory', payload);
    } catch (e) {
      throw normalizeError(e);
    }
  }

  async createOrder(payload: CreateOrderPayload): Promise<CreateOrderResult> {
    try {
      const { data } = await restClient.post<CreateOrderResult>('/orders', payload);
      return data;
    } catch (e) {
      throw normalizeError(e);
    }
  }

  async fetchOrder(id: number | string): Promise<Order | null> {
    try {
      const { data } = await restClient.get<Order>(`/orders/${id}`);
      return data;
    } catch (e) {
      throw normalizeError(e);
    }
  }

  async fetchMyOrders(): Promise<Order[]> {
    try {
      const { data } = await restClient.get<Order[]>('/orders/mine');
      return data;
    } catch (e) {
      throw normalizeError(e);
    }
  }

  getOrderPdfUrl(id: number | string): string {
    return `${restClient.defaults.baseURL}/orders/${id}/pdf`;
  }
}
