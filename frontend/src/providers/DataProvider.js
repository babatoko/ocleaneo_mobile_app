/**
 * Contrat que toute source de données (REST/Odoo, mock local, un futur
 * GraphQL ou JSON-RPC Odoo…) doit respecter pour être branchée à l'app. Les
 * stores et les vues ne parlent qu'à ce contrat — jamais directement à un
 * client HTTP, un SDK ou une forme de payload précise — pour que changer de
 * backend n'impose de toucher qu'un fichier `providers/*Provider.js`, jamais
 * la logique métier ni les écrans. Voir `providers/index.js` pour la
 * sélection du provider actif et `README.md` § Architecture backend-agnostique.
 *
 * Chaque méthode ci-dessous documente la forme attendue en entrée/sortie ;
 * l'implémentation de base ne fait que signaler qu'un provider concret ne
 * l'a pas (encore) implémentée, plutôt que d'échouer silencieusement.
 */
export class DataProvider {
  // --- Authentification --------------------------------------------------

  /** @returns {Promise<{ token: string, employee: object }>} */
  async login(_username, _password) {
    throw notImplemented('login');
  }

  /** @returns {Promise<object>} l'employé connecté */
  async fetchMe() {
    throw notImplemented('fetchMe');
  }

  // --- Chantiers -----------------------------------------------------------

  /** @returns {Promise<object[]>} chantiers du salarié (avec nfc_tag_id, latitude/longitude si connus) */
  async fetchChantiers() {
    throw notImplemented('fetchChantiers');
  }

  // --- Planning ------------------------------------------------------------

  /** @param {{ from: string, to: string }} range dates ISO (YYYY-MM-DD), inclusives
   *  @returns {Promise<object[]>} vacations sur la période */
  async fetchShifts(_range) {
    throw notImplemented('fetchShifts');
  }

  // --- Pointage --------------------------------------------------------------

  /** @returns {Promise<{ entries: object[], status: 'in'|'out'|'paused' }>} */
  async fetchTodayTimeEntries() {
    throw notImplemented('fetchTodayTimeEntries');
  }

  /** @param {{ from: string, to: string }} range
   *  @returns {Promise<object[]>} pointages sur la période */
  async fetchTimeEntries(_range) {
    throw notImplemented('fetchTimeEntries');
  }

  /** @param {{ chantierId: number, shiftId?: number, type: 'in'|'out'|'pause_start'|'pause_end', recordedAt: string, latitude?: number, longitude?: number, outOfRange?: boolean }} payload */
  async createTimeEntry(_payload) {
    throw notImplemented('createTimeEntry');
  }

  // --- Produits / stock ------------------------------------------------------

  /** @returns {Promise<object[]>} catalogue produits (avec packagings) */
  async fetchProducts() {
    throw notImplemented('fetchProducts');
  }

  /** @returns {Promise<{ items: object[] } | null>} null si aucun inventaire enregistré pour ce chantier */
  async fetchInventoryLatest(_chantierId) {
    throw notImplemented('fetchInventoryLatest');
  }

  /** @param {{ chantierId: number, items: { productId: number, packagingId: number, quantityRemaining: number }[] }} payload */
  async submitInventory(_payload) {
    throw notImplemented('submitInventory');
  }

  // --- Commandes ---------------------------------------------------------

  /** @param {{ chantierId: number, items: { productId: number, packagingId: number, quantity: number }[] }} payload
   *  @returns {Promise<{ id: number }>} */
  async createOrder(_payload) {
    throw notImplemented('createOrder');
  }

  /** @returns {Promise<object|null>} détail d'une commande */
  async fetchOrder(_id) {
    throw notImplemented('fetchOrder');
  }

  /** @returns {Promise<object[]>} commandes du salarié, plus récentes en premier */
  async fetchMyOrders() {
    throw notImplemented('fetchMyOrders');
  }

  /** @returns {string|null} URL du PDF d'une commande, ou null si ce provider ne le supporte pas */
  getOrderPdfUrl(_id) {
    return null;
  }
}

function notImplemented(method) {
  return new Error(`DataProvider.${method}() n'est pas implémenté par ce provider.`);
}

/**
 * Erreur réseau (coupure de connexion, pas de réponse du serveur) — à
 * distinguer d'une erreur métier renvoyée par le backend (identifiants
 * invalides, badge inconnu…). Tout provider doit lever ce type précis pour
 * une coupure réseau, afin que le code appelant (file d'attente hors ligne,
 * cache local) puisse réagir sans connaître la forme d'erreur propre à
 * chaque backend (ex. `error.response` d'axios).
 */
export class ProviderNetworkError extends Error {
  constructor(message = 'Connexion impossible.') {
    super(message);
    this.name = 'ProviderNetworkError';
    this.isNetworkError = true;
  }
}
