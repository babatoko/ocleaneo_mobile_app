import type {
  Chantier,
  CreateOrderPayload,
  CreateOrderResult,
  CreateTimeEntryPayload,
  DateRange,
  Employee,
  LoginResult,
  Order,
  Product,
  Shift,
  SubmitInventoryPayload,
  TimeEntry,
  TodayTimeEntries,
  InventoryLatest,
} from '../types/models';

/**
 * Contrat que toute source de données (REST/Odoo, mock local, un futur
 * GraphQL ou JSON-RPC Odoo…) doit respecter pour être branchée à l'app. Les
 * stores et les vues ne parlent qu'à ce contrat — jamais directement à un
 * client HTTP, un SDK ou une forme de payload précise — pour que changer de
 * backend n'impose de toucher qu'un fichier `providers/*Provider.ts`, jamais
 * la logique métier ni les écrans. Voir `providers/index.ts` pour la
 * sélection du provider actif et `README.md` § Architecture backend-agnostique.
 *
 * L'implémentation par défaut de chaque méthode se contente de signaler
 * qu'un provider concret ne l'a pas (encore) implémentée, plutôt que
 * d'échouer silencieusement.
 */
/**
 * Domaines fonctionnels qu'un backend peut ne pas couvrir. Tous les
 * backends ne se valent pas : le provider Odoo actuel sait pointer et
 * planifier, mais n'a aucune route pour le stock ni les commandes (voir
 * `OdooProvider.ts` et `odoo/README.md`). Plutôt que de laisser l'écran
 * appeler puis échouer — spinner, puis message d'erreur technique — une
 * vue demande d'abord `provider.supports(...)` et affiche une explication.
 */
export type ProviderFeature = 'products' | 'inventory' | 'orders';

/** Phrase montrée au salarié quand un domaine n'est pas couvert. Écrite
 *  pour quelqu'un sur le terrain : ce qui ne marche pas, et le fait que
 *  ce n'est pas une panne de son téléphone. */
export const UNSUPPORTED_MESSAGES: Record<ProviderFeature, string> = {
  products: "Le catalogue produits n'est pas disponible avec ce serveur.",
  inventory: "L'inventaire n'est pas disponible avec ce serveur.",
  orders: "Les commandes ne sont pas disponibles avec ce serveur.",
};

export abstract class DataProvider {
  // --- Capacités -----------------------------------------------------------

  /** Un provider qui ne couvre pas un domaine le déclare ici. Par défaut
   *  tout est supporté : c'est au provider incomplet de se signaler, pas à
   *  chaque nouveau provider de penser à s'autoriser. */
  supports(_feature: ProviderFeature): boolean {
    return true;
  }

  // --- Cycle de vie --------------------------------------------------------

  /** Appelé une fois au démarrage de l'app, avant le premier appel de données
   *  (voir `providers/index.ts`). No-op par défaut ; un provider réseau s'en
   *  sert pour appliquer une config persistée (ex. URL de serveur). */
  async init(): Promise<void> {}

  // --- Configuration -------------------------------------------------------

  /** URL du serveur actuellement utilisée, ou null si ce provider n'en a pas
   *  (ex. MockProvider, 100 % en mémoire) — le profil masque alors le réglage
   *  correspondant. */
  getServerUrl(): string | null {
    return null;
  }

  /** URL de serveur par défaut (avant toute personnalisation). */
  getDefaultServerUrl(): string | null {
    return null;
  }

  /** @param _url Vide pour revenir à la valeur par défaut. */
  async setServerUrl(_url: string): Promise<void> {
    throw notImplemented('setServerUrl');
  }

  // --- Authentification --------------------------------------------------

  async login(_username: string, _password: string): Promise<LoginResult> {
    throw notImplemented('login');
  }

  /** L'employé connecté. */
  async fetchMe(): Promise<Employee> {
    throw notImplemented('fetchMe');
  }

  // --- Chantiers -----------------------------------------------------------

  /** Chantiers du salarié (avec nfc_tag_id, latitude/longitude si connus). */
  async fetchChantiers(): Promise<Chantier[]> {
    throw notImplemented('fetchChantiers');
  }

  // --- Planning ------------------------------------------------------------

  /** @param _range dates ISO (YYYY-MM-DD), inclusives. Vacations sur la période. */
  async fetchShifts(_range: DateRange): Promise<Shift[]> {
    throw notImplemented('fetchShifts');
  }

  // --- Pointage --------------------------------------------------------------

  async fetchTodayTimeEntries(): Promise<TodayTimeEntries> {
    throw notImplemented('fetchTodayTimeEntries');
  }

  /** Pointages sur la période. */
  async fetchTimeEntries(_range: DateRange): Promise<TimeEntry[]> {
    throw notImplemented('fetchTimeEntries');
  }

  async createTimeEntry(_payload: CreateTimeEntryPayload): Promise<TimeEntry> {
    throw notImplemented('createTimeEntry');
  }

  // --- Produits / stock ------------------------------------------------------

  /** Catalogue produits (avec packagings). */
  async fetchProducts(): Promise<Product[]> {
    throw notImplemented('fetchProducts');
  }

  /** null si aucun inventaire enregistré pour ce chantier. */
  async fetchInventoryLatest(_chantierId: number): Promise<InventoryLatest | null> {
    throw notImplemented('fetchInventoryLatest');
  }

  async submitInventory(_payload: SubmitInventoryPayload): Promise<void> {
    throw notImplemented('submitInventory');
  }

  // --- Commandes ---------------------------------------------------------

  async createOrder(_payload: CreateOrderPayload): Promise<CreateOrderResult> {
    throw notImplemented('createOrder');
  }

  /** Détail d'une commande, ou null si introuvable. */
  async fetchOrder(_id: number | string): Promise<Order | null> {
    throw notImplemented('fetchOrder');
  }

  /** Commandes du salarié, plus récentes en premier. */
  async fetchMyOrders(): Promise<Order[]> {
    throw notImplemented('fetchMyOrders');
  }

  /** URL du PDF d'une commande, ou null si ce provider ne le supporte pas. */
  getOrderPdfUrl(_id: number | string): string | null {
    return null;
  }
}

function notImplemented(method: string): Error {
  return new ProviderUnsupportedError(
    `Cette fonctionnalité n'est pas disponible avec ce serveur.`,
    method,
  );
}

/**
 * Le provider actif ne couvre pas ce domaine — ce n'est ni une panne ni une
 * coupure réseau, et réessayer n'y changera rien. Type distinct pour que les
 * écrans l'affichent comme une indisponibilité (message explicatif, sans
 * bouton Réessayer) au lieu d'une erreur ; sans ça le salarié voyait remonter
 * le nom de la méthode manquante, du jargon qui ne lui apprend rien.
 *
 * Filet de sécurité seulement : un écran bien écrit interroge
 * `provider.supports()` avant d'appeler (voir ProviderFeature).
 */
export class ProviderUnsupportedError extends Error {
  isUnsupported = true;
  /** Méthode du contrat qui manque — pour les logs, jamais pour l'écran. */
  method?: string;

  constructor(message = "Cette fonctionnalité n'est pas disponible avec ce serveur.", method?: string) {
    super(message);
    this.name = 'ProviderUnsupportedError';
    this.method = method;
  }
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
  isNetworkError = true;

  constructor(message = 'Connexion impossible.') {
    super(message);
    this.name = 'ProviderNetworkError';
  }
}

/**
 * Erreur métier normalisée levée par un provider (identifiants invalides,
 * ressource introuvable...) — porte le code HTTP d'origine quand il existe,
 * sans jamais exposer la forme brute (axios ou autre) du provider concret.
 */
export class ProviderError extends Error {
  status?: number;

  constructor(message: string, status?: number) {
    super(message);
    this.name = 'ProviderError';
    this.status = status;
  }
}
