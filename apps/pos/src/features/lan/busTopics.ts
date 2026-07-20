// apps/pos/src/features/lan/busTopics.ts
// Spec 006x lot 3 — payloads typés des topics métier du bus LAN + gardes de
// parsing (le bus transporte du JSON non fiable : tout est validé à l'entrée).
// Aucun secret, aucun prix négocié, aucun nonce ne transite ici (spec §6).

export interface BusModifierLine {
  group_name: string;
  option_label: string;
  price_adjustment: number;
}

export interface BusFiredItem {
  /** UUID client — identité de la ligne sur le bus (pas d'id DB offline). */
  id: string;
  product_id: string;
  product_name: string;
  quantity: number;
  unit_price: number;
  modifiers: BusModifierLine[];
  /** Stations résolues au fire via la station map (peut être vide si la
   *  catégorie ne route nulle part — la ligne n'apparaît sur aucun KDS). */
  dispatch_stations: string[];
}

/** `order.fired` — une commande part en cuisine hors-ligne (spec §4.3 OFFLINE). */
export interface OrderFiredPayload {
  /** Idempotence du fire — le MÊME uuid rejouera la RPC au retour online (lot 4). */
  client_uuid: string;
  /** Numéro local `L-<seq terminal>` (spec §4.3). */
  order_number: string;
  order_type: string;
  table_number: string | null;
  notes: string | null;
  fired_at: string;
  items: BusFiredItem[];
}

export type BusKitchenStatus = 'preparing' | 'ready' | 'served';

/** `order.item_status` — le KDS fait avancer une ligne hors-ligne. */
export interface OrderItemStatusPayload {
  /** == BusFiredItem.id */
  item_id: string;
  /** == OrderFiredPayload.client_uuid (order id local). */
  order_id: string;
  kitchen_status: BusKitchenStatus;
  at: string;
  /** Dénormalisés pour le customer display (rendable même sans le fired). */
  order_number: string;
  order_type: string;
  table_number: string | null;
}

function isRecord(x: unknown): x is Record<string, unknown> {
  return typeof x === 'object' && x !== null;
}

function isModifier(x: unknown): x is BusModifierLine {
  return isRecord(x)
    && typeof x.group_name === 'string'
    && typeof x.option_label === 'string'
    && typeof x.price_adjustment === 'number';
}

function isFiredItem(x: unknown): x is BusFiredItem {
  return isRecord(x)
    && typeof x.id === 'string' && x.id !== ''
    && typeof x.product_id === 'string'
    && typeof x.product_name === 'string'
    && typeof x.quantity === 'number' && x.quantity > 0
    && typeof x.unit_price === 'number'
    && Array.isArray(x.modifiers) && x.modifiers.every(isModifier)
    && Array.isArray(x.dispatch_stations) && x.dispatch_stations.every((s) => typeof s === 'string');
}

export function parseOrderFired(x: unknown): OrderFiredPayload | null {
  if (!isRecord(x)) return null;
  if (typeof x.client_uuid !== 'string' || x.client_uuid === '') return null;
  if (typeof x.order_number !== 'string' || x.order_number === '') return null;
  if (typeof x.order_type !== 'string') return null;
  if (x.table_number !== null && typeof x.table_number !== 'string') return null;
  if (x.notes !== null && typeof x.notes !== 'string') return null;
  if (typeof x.fired_at !== 'string' || Number.isNaN(Date.parse(x.fired_at))) return null;
  if (!Array.isArray(x.items) || x.items.length === 0 || !x.items.every(isFiredItem)) return null;
  return {
    client_uuid: x.client_uuid,
    order_number: x.order_number,
    order_type: x.order_type,
    table_number: x.table_number,
    notes: x.notes,
    fired_at: x.fired_at,
    items: x.items,
  };
}

const KITCHEN_STATUSES: readonly BusKitchenStatus[] = ['preparing', 'ready', 'served'];

export function parseOrderItemStatus(x: unknown): OrderItemStatusPayload | null {
  if (!isRecord(x)) return null;
  if (typeof x.item_id !== 'string' || x.item_id === '') return null;
  if (typeof x.order_id !== 'string' || x.order_id === '') return null;
  if (typeof x.kitchen_status !== 'string'
    || !(KITCHEN_STATUSES as readonly string[]).includes(x.kitchen_status)) return null;
  if (typeof x.at !== 'string' || Number.isNaN(Date.parse(x.at))) return null;
  if (typeof x.order_number !== 'string') return null;
  if (typeof x.order_type !== 'string') return null;
  if (x.table_number !== null && typeof x.table_number !== 'string') return null;
  return {
    item_id: x.item_id,
    order_id: x.order_id,
    kitchen_status: x.kitchen_status as BusKitchenStatus,
    at: x.at,
    order_number: x.order_number,
    order_type: x.order_type,
    table_number: x.table_number,
  };
}
