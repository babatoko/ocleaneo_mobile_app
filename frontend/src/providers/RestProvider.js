import { restClient } from './restClient';
import { DataProvider, ProviderNetworkError } from './DataProvider';

function normalizeError(e) {
  if (!e.response) return new ProviderNetworkError();
  const err = new Error(e.response.data?.error || e.message || 'Erreur serveur.');
  err.status = e.response.status;
  return err;
}

/**
 * Implémentation REST du contrat DataProvider — le "plugin" branché par
 * défaut, pensé pour parler à une couche `base_rest` Odoo (voir README
 * § Intégration Odoo). Toute la connaissance du protocole HTTP/JSON et des
 * chemins d'URL vit ici ; rien de ça ne doit fuiter vers les stores/vues.
 */
export class RestProvider extends DataProvider {
  async login(username, password) {
    try {
      const { data } = await restClient.post('/auth/login', { username, password });
      return data;
    } catch (e) {
      throw normalizeError(e);
    }
  }

  async fetchMe() {
    try {
      const { data } = await restClient.get('/auth/me');
      return data;
    } catch (e) {
      throw normalizeError(e);
    }
  }

  async fetchChantiers() {
    try {
      const { data } = await restClient.get('/chantiers/mine');
      return data;
    } catch (e) {
      throw normalizeError(e);
    }
  }

  async fetchShifts({ from, to }) {
    try {
      const { data } = await restClient.get('/shifts/mine', { params: { from, to } });
      return data;
    } catch (e) {
      throw normalizeError(e);
    }
  }

  async fetchTodayTimeEntries() {
    try {
      const { data } = await restClient.get('/time-entries/today');
      return data;
    } catch (e) {
      throw normalizeError(e);
    }
  }

  async fetchTimeEntries({ from, to }) {
    try {
      const { data } = await restClient.get('/time-entries/mine', { params: { from, to } });
      return data;
    } catch (e) {
      throw normalizeError(e);
    }
  }

  async createTimeEntry(payload) {
    try {
      const { data } = await restClient.post('/time-entries', payload);
      return data;
    } catch (e) {
      throw normalizeError(e);
    }
  }

  async fetchProducts() {
    try {
      const { data } = await restClient.get('/products');
      return data;
    } catch (e) {
      throw normalizeError(e);
    }
  }

  async fetchInventoryLatest(chantierId) {
    try {
      const { data } = await restClient.get(`/inventory/chantier/${chantierId}/latest`);
      return data;
    } catch (e) {
      if (e.response?.status === 404) return null; // pas d'inventaire enregistré, pas une erreur
      throw normalizeError(e);
    }
  }

  async submitInventory(payload) {
    try {
      const { data } = await restClient.post('/inventory', payload);
      return data;
    } catch (e) {
      throw normalizeError(e);
    }
  }

  async createOrder(payload) {
    try {
      const { data } = await restClient.post('/orders', payload);
      return data;
    } catch (e) {
      throw normalizeError(e);
    }
  }

  async fetchOrder(id) {
    try {
      const { data } = await restClient.get(`/orders/${id}`);
      return data;
    } catch (e) {
      throw normalizeError(e);
    }
  }

  async fetchMyOrders() {
    try {
      const { data } = await restClient.get('/orders/mine');
      return data;
    } catch (e) {
      throw normalizeError(e);
    }
  }

  getOrderPdfUrl(id) {
    return `${restClient.defaults.baseURL}/orders/${id}/pdf`;
  }
}
