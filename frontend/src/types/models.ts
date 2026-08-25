/**
 * Formes de données échangées avec un DataProvider (voir
 * `providers/DataProvider.ts`). C'est la frontière la plus fragile de l'app —
 * celle où un champ renommé ou un contrat mal aligné entre deux providers
 * passe inaperçu en JavaScript et casse un écran en silence — donc celle où
 * le typage rapporte le plus.
 */

export interface Employee {
  id: number;
  name: string;
}

export interface Chantier {
  id: number;
  name: string;
  address: string;
  is_active: number;
  nfc_tag_id?: string | null;
  latitude?: number | null;
  longitude?: number | null;
}

export type ShiftStatus = 'confirmed' | 'cancelled' | string;

export interface Shift {
  id: number;
  employee_id: number;
  chantier_id: number;
  chantier_name: string;
  chantier_address: string;
  start_at: string;
  end_at: string;
  status: ShiftStatus;
  note?: string | null;
}

export type TimeEntryType = 'in' | 'out' | 'pause_start' | 'pause_end';
export type PointageStatus = 'in' | 'out' | 'paused';

export interface TimeEntry {
  id: number | string;
  type: TimeEntryType;
  chantier_id: number;
  chantier_name?: string;
  shift_id?: number;
  recorded_at: string;
  pending?: boolean;
}

export interface TodayTimeEntries {
  entries: TimeEntry[];
  status: PointageStatus;
}

export interface Packaging {
  id: number;
  label: string;
  is_default?: boolean;
}

export interface Product {
  id: number;
  name: string;
  emoji?: string;
  category?: string;
  is_active: number;
  packagings: Packaging[];
}

export interface InventoryItem {
  product_id: number;
  packaging_id: number;
  quantity_remaining: number;
}

export interface InventoryLatest {
  items: InventoryItem[];
}

export interface OrderItem {
  id?: number;
  product_emoji?: string;
  product_name?: string;
  packaging_label?: string;
  quantity: number;
}

export type OrderStatus = 'confirmed' | 'pending' | 'cancelled' | string;

export interface Order {
  id: number;
  chantier_name: string;
  status: OrderStatus;
  created_at: string;
  items: OrderItem[];
}

export interface DateRange {
  from: string;
  to: string;
}

export interface LoginResult {
  token: string;
  employee: Employee;
}

export interface CreateTimeEntryPayload {
  chantierId: number;
  shiftId?: number;
  type: TimeEntryType;
  recordedAt: string;
  latitude?: number;
  longitude?: number;
  outOfRange?: boolean;
}

export interface SubmitInventoryItemPayload {
  productId: number;
  packagingId: number;
  quantityRemaining: number;
}

export interface SubmitInventoryPayload {
  chantierId: number;
  items: SubmitInventoryItemPayload[];
}

export interface CreateOrderItemPayload {
  productId: number;
  packagingId: number;
  quantity: number;
}

export interface CreateOrderPayload {
  chantierId: number;
  items: CreateOrderItemPayload[];
}

export interface CreateOrderResult {
  id: number;
}

export interface Position {
  latitude: number;
  longitude: number;
}
