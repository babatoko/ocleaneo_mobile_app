import axios from 'axios';
import { DEFAULT_ODOO_BASE_URL, getOdooBaseUrl, initOdooBaseUrl, odooClient, setOdooBaseUrl } from './odooClient';
import { DataProvider, ProviderError, ProviderNetworkError } from './DataProvider';
import type {
  Chantier,
  CreateTimeEntryPayload,
  DateRange,
  Employee,
  LoginResult,
  PointageStatus,
  Shift,
  TimeEntry,
  TimeEntryType,
  TodayTimeEntries,
} from '../types/models';

/**
 * Implémentation Odoo 14 du contrat DataProvider — parle au backend sous
 * `odoo/addons/ocleaneo_mobile_*` (voir odoo/README.md pour le détail des
 * routes). Deux différences structurelles avec RestProvider.ts, propres à
 * Odoo, sont concentrées ici :
 *
 * 1. Toutes les routes sont en JSON-RPC 2.0 (`type="json"` côté Odoo), pas
 *    en REST — chaque appel s'enveloppe dans {jsonrpc, method, params} et
 *    la réponse s'y trouve sous `.result` (ou `.error` pour une exception
 *    non gérée côté serveur). Voir callMobile() ci-dessous.
 * 2. Les erreurs "métier" (token invalide, IDOR, validation…) ne sont pas
 *    des codes HTTP — elles arrivent en HTTP 200 avec un corps
 *    `{error, code}` à l'intérieur de `.result` (voir les contrôleurs
 *    Python : `return {"error": "...", "code": 401}`). callMobile() les
 *    détecte et les relève en ProviderError, comme le ferait un vrai 401.
 *
 * Domaines non couverts par ce backend (voir odoo/README.md § Vérification
 * et docs/backend-integration-plan.md) : catalogue produits, inventaire,
 * commandes — aucune route Odoo n'existe pour ces trois-là aujourd'hui.
 * Ces méthodes restent donc sur l'implémentation par défaut de
 * DataProvider (qui lève une erreur explicite plutôt que d'échouer en
 * silence) : ce n'est pas un oubli, juste un périmètre pas encore construit
 * côté Odoo.
 */
export class OdooProvider extends DataProvider {
  async init(): Promise<void> {
    await initOdooBaseUrl();
  }

  getServerUrl(): string | null {
    return getOdooBaseUrl() ?? null;
  }

  getDefaultServerUrl(): string {
    return DEFAULT_ODOO_BASE_URL;
  }

  async setServerUrl(url: string): Promise<void> {
    await setOdooBaseUrl(url);
  }

  async login(username: string, password: string): Promise<LoginResult> {
    const data = await callMobile<OdooLoginResult>('/auth/login', { login: username, password });
    return {
      token: data.token,
      employee: employeeFromLogin(data),
    };
  }

  async fetchMe(): Promise<Employee> {
    const data = await callMobile<OdooMeResult>('/auth/me');
    return { id: data.employee_id || 0, name: data.employee_name || data.user_name };
  }

  async fetchChantiers(): Promise<Chantier[]> {
    const data = await callMobile<OdooChantiersResult>('/chantiers/aujourdhui');
    return data.orders.map(orderToChantier);
  }

  async fetchShifts({ from, to }: DateRange): Promise<Shift[]> {
    const data = await callMobile<OdooPlanningResult>('/planning', { date_from: from, date_to: to });
    return data.orders.map(planningOrderToShift);
  }

  async fetchTodayTimeEntries(): Promise<TodayTimeEntries> {
    const data = await callMobile<OdooPointageMineResult>('/pointage/mine');
    const entries = data.entries.map(pointageEntryToTimeEntry);
    return { entries, status: computeStatus(entries) };
  }

  async fetchTimeEntries({ from, to }: DateRange): Promise<TimeEntry[]> {
    const data = await callMobile<OdooPointageMineResult>('/pointage/mine', { date_from: from, date_to: to });
    return data.entries.map(pointageEntryToTimeEntry);
  }

  async createTimeEntry(payload: CreateTimeEntryPayload): Promise<TimeEntry> {
    const data = await callMobile<OdooPointageResponse>('/pointage', {
      type: TYPE_TO_ODOO[payload.type],
      fsm_order_id: payload.chantierId,
      // Déjà un ISO UTC (`new Date().toISOString()`, voir stores/pointage.ts) —
      // pas de conversion nécessaire : le backend accepte aussi bien un
      // horaire local nu qu'un horaire avec offset/Z explicite (voir
      // odoo/addons/ocleaneo_mobile_api/tools/mobile_time.local_to_utc).
      datetime: payload.recordedAt,
      gps_latitude: payload.latitude,
      gps_longitude: payload.longitude,
      client_ref: payload.clientRef,
    });
    return {
      id: data.id,
      type: TYPE_TO_FRONTEND[data.type] || payload.type,
      chantier_id: data.fsm_order_id || payload.chantierId,
      recorded_at: withUtcSuffix(data.datetime),
      client_ref: payload.clientRef,
    };
  }
}

// --- Forme brute des réponses Odoo (JSON-RPC .result) ------------------

interface OdooLoginResult {
  token: string;
  user_id: number;
  user_login: string;
  user_name: string;
  employee_id: number | false;
  employee_name: string | false;
}

interface OdooMeResult {
  user_id: number;
  user_name: string;
  employee_id: number | false;
  employee_name: string | false;
}

interface OdooChantierOrder {
  id: number;
  name: string;
  location_name: string | false;
  location_street: string | false;
  location_city: string | false;
  location_latitude: number | false;
  location_longitude: number | false;
}

interface OdooChantiersResult {
  count: number;
  orders: OdooChantierOrder[];
}

interface OdooPlanningLocation {
  name: string | false;
  street: string | false;
  city: string | false;
}

interface OdooPlanningOrder {
  id: number;
  name: string;
  person_id: number | false;
  scheduled_date_start: string | false;
  scheduled_date_end: string | false;
  date_start: string | false;
  date_end: string | false;
  location: OdooPlanningLocation;
}

interface OdooPlanningResult {
  count: number;
  orders: OdooPlanningOrder[];
}

interface OdooPointageResponse {
  id: number;
  type: string;
  datetime: string | false;
  fsm_order_id: number | false;
}

interface OdooPointageEntry {
  id: number;
  type: string;
  datetime: string | false;
  fsm_order_id: number | false;
  client_ref: string | false;
}

interface OdooPointageMineResult {
  count: number;
  entries: OdooPointageEntry[];
}

// --- Traduction de vocabulaire (voir docs/backend-integration-plan.md) --

const TYPE_TO_FRONTEND: Record<string, TimeEntryType> = {
  arrivee: 'in',
  depart: 'out',
  pause_debut: 'pause_start',
  pause_fin: 'pause_end',
};

const TYPE_TO_ODOO: Record<TimeEntryType, string> = {
  in: 'arrivee',
  out: 'depart',
  pause_start: 'pause_debut',
  pause_end: 'pause_fin',
};

function employeeFromLogin(data: OdooLoginResult): Employee {
  return { id: data.employee_id || 0, name: data.employee_name || data.user_name };
}

function joinAddress(parts: Array<string | false | undefined | null>): string {
  return parts.filter((s): s is string => Boolean(s)).join(', ');
}

function orderToChantier(order: OdooChantierOrder): Chantier {
  return {
    id: order.id,
    name: order.location_name || order.name,
    address: joinAddress([order.location_street, order.location_city]),
    is_active: 1,
    latitude: order.location_latitude || null,
    longitude: order.location_longitude || null,
  };
}

function planningOrderToShift(order: OdooPlanningOrder): Shift {
  const loc = order.location;
  const startAt = withUtcSuffix(order.scheduled_date_start || order.date_start);
  return {
    id: order.id,
    // id du fsm.person, pas de l'hr.employee — /planning ne renvoie pas
    // l'un ni l'autre sous cette forme ; ce champ n'est utilisé nulle
    // part côté frontend pour croiser avec Employee.id, seulement à
    // titre informatif.
    employee_id: order.person_id || 0,
    // Dans ce provider, "chantier" == commande fsm.order assignée pour la
    // journée : chaque vacation planning correspond à une seule commande,
    // donc chantier_id == shift id (voir aussi fetchChantiers()).
    chantier_id: order.id,
    chantier_name: loc.name || order.name,
    chantier_address: joinAddress([loc.street, loc.city]),
    start_at: startAt,
    end_at: endAtWithFallback(order, startAt),
    // Le backend ne distingue pas "confirmed"/"cancelled" : /planning et
    // /chantiers/aujourdhui excluent déjà les commandes fermées
    // (stage_id.is_closed), donc tout ce qui est renvoyé est actif.
    status: 'confirmed',
  };
}

/** fsm.order.scheduled_date_end n'est pas garanti renseigné côté Odoo — le
 *  domaine de /planning gère explicitement le cas (`scheduled_date_end =
 *  False`) comme une commande "sans fin planifiée". Mais Shift.end_at est
 *  une chaîne obligatoire côté contrat frontend : `new Date('')` donne un
 *  Invalid Date que les vues affichent tel quel (vérifié en conditions
 *  réelles). À défaut de mieux, on retombe sur une vacation de 8h à
 *  partir du début — une heuristique explicite, pas une vraie donnée. */
function endAtWithFallback(order: OdooPlanningOrder, startAtUtc: string): string {
  const end = withUtcSuffix(order.scheduled_date_end || order.date_end);
  if (end) return end;
  if (!startAtUtc) return '';
  const start = new Date(startAtUtc);
  if (Number.isNaN(start.getTime())) return '';
  return new Date(start.getTime() + 8 * 60 * 60 * 1000).toISOString();
}

function pointageEntryToTimeEntry(entry: OdooPointageEntry): TimeEntry {
  return {
    id: entry.id,
    type: TYPE_TO_FRONTEND[entry.type] || 'in',
    chantier_id: entry.fsm_order_id || 0,
    recorded_at: withUtcSuffix(entry.datetime),
    client_ref: entry.client_ref || undefined,
  };
}

/** Même logique que MockProvider.fetchTodayTimeEntries, pour un statut
 *  cohérent quel que soit le provider actif. */
function computeStatus(entries: TimeEntry[]): PointageStatus {
  const last = entries[entries.length - 1];
  if (!last) return 'out';
  if (last.type === 'pause_start') return 'paused';
  if (last.type === 'pause_end') return 'in';
  return last.type;
}

/** `fields.Datetime.isoformat()` d'Odoo sur une valeur UTC naïve n'a pas de
 *  Z/offset final (ex. "2026-08-26T06:00:00") — `new Date(...)` sur une
 *  telle chaîne est interprété comme une heure LOCALE en JS, pas UTC, ce
 *  qui décale silencieusement chaque horodatage de l'offset de l'appareil.
 *  Toute date en provenance de ce backend doit passer par ici avant
 *  d'atteindre le reste de l'app, qui attend des chaînes au format
 *  Date.toISOString() standard (suffixées Z) — celles que
 *  MockProvider/RestProvider produisent déjà. */
function withUtcSuffix(iso: string | false): string {
  if (!iso) return '';
  return /[Zz]|[+-]\d{2}:?\d{2}$/.test(iso) ? iso : `${iso}Z`;
}

// --- Enveloppe JSON-RPC 2.0 ----------------------------------------------

interface JsonRpcSuccess<T> {
  jsonrpc: '2.0';
  id: number | string | null;
  result: T;
}

interface JsonRpcFailure {
  jsonrpc: '2.0';
  id: number | string | null;
  error: { code: number; message: string; data?: { message?: string } };
}

type JsonRpcResponse<T> = JsonRpcSuccess<T> | JsonRpcFailure;

/** Forme des erreurs "métier" renvoyées par nos propres contrôleurs
 *  (`return {"error": "...", "code": 401}`), à l'intérieur de `.result` —
 *  distincte d'une exception Odoo non gérée, qui arrive elle sous `.error`
 *  au niveau JSON-RPC (voir JsonRpcFailure). Les deux doivent devenir une
 *  ProviderError côté frontend ; seule la première déclenche en plus le
 *  nettoyage du token (code 401 = token invalide/expiré confirmé par le
 *  serveur, pas juste une coupure réseau). */
interface MobileErrorResult {
  error: string;
  code: number;
}

function isMobileErrorResult(x: unknown): x is MobileErrorResult {
  return typeof x === 'object' && x !== null && 'error' in x && 'code' in x;
}

let rpcId = 0;

async function callMobile<T>(path: string, params: Record<string, unknown> = {}): Promise<T> {
  let httpResponse;
  try {
    httpResponse = await odooClient.post<JsonRpcResponse<T | MobileErrorResult>>(path, {
      jsonrpc: '2.0',
      method: 'call',
      id: ++rpcId,
      params,
    });
  } catch (e) {
    throw normalizeTransportError(e);
  }

  const body = httpResponse.data;
  if ('error' in body) {
    const message = body.error.data?.message || body.error.message || 'Erreur serveur Odoo.';
    throw new ProviderError(message, body.error.code);
  }

  const result = body.result;
  if (isMobileErrorResult(result)) {
    // Contrairement à restClient.ts (RestProvider), un token invalide
    // n'est jamais un 401 HTTP ici — voir la docstring de classe.
    if (result.code === 401) localStorage.removeItem('ocleaneo_token');
    throw new ProviderError(result.error, result.code);
  }
  return result as T;
}

function normalizeTransportError(e: unknown): Error {
  if (axios.isAxiosError(e) && e.response) {
    return new ProviderError(e.message || 'Erreur serveur.', e.response.status);
  }
  return new ProviderNetworkError();
}
