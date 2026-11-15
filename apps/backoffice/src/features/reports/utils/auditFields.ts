// Champs typés d'un événement du journal, lus dans la trace telle qu'elle est stockée.
// Rien n'est inventé : une valeur absente de la trace reste vide dans l'export.
// La description lisible reste dans auditDescription ; ici chaque valeur a sa case.
import type { AuditLogRow } from '../hooks/useAuditLogs.js';
import { auditIsSecretKey, auditNumber, auditRecord, auditText } from './auditValues.js';

export interface AuditFields {
  orderNumber: string | null;
  orderId: string | null;
  terminalId: string | null;
  shiftId: string | null;
  table: string | null;
  product: string | null;
  productId: string | null;
  quantity: number | null;
  unit: string | null;
  amount: number | null;
  paymentMethod: string | null;
  before: string | null;
  after: string | null;
  reasonCode: string | null;
  reasonNote: string | null;
  outcome: 'success' | 'failed' | null;
}

const ORDER_ENTITIES = new Set(['order', 'orders']);
const SHIFT_ENTITIES = new Set(['pos_session', 'pos_sessions']);
const PRODUCT_ENTITIES = new Set(['product', 'products']);
// Un code est un identifiant technique : minuscules, chiffres et séparateurs, sans espace.
const CODE = /^[a-z][a-z0-9]*(?:[_.:-][a-z0-9]+)*$/;

function scalar(value: unknown): string | null {
  if (typeof value === 'number' || typeof value === 'boolean') return String(value);
  return auditText(value);
}

function first(...values: unknown[]): string | null {
  for (const value of values) {
    const text = scalar(value);
    if (text !== null) return text;
  }
  return null;
}

function paymentMethod(context: Record<string, unknown>, details: Record<string, unknown>): string | null {
  const single = first(context.method, context.payment_method, details.method);
  if (single !== null) return single;
  const list = [context.payment_methods, details.methods].find(Array.isArray) as unknown[] | undefined;
  if (list === undefined) return null;
  const names = list
    .map((item) => (typeof item === 'string' ? item : auditText(auditRecord(item).method)))
    .filter((name): name is string => name !== null && name !== '');
  return names.length ? [...new Set(names)].join('+') : null;
}

/** Valeur avant / après, par famille d'événement. Jamais un secret. */
function change(row: AuditLogRow, context: Record<string, unknown>, details: Record<string, unknown>): [string | null, string | null] {
  if (row.action === 'pos.table_assigned') {
    return [first(details.from, details.previous_table), first(details.to, details.table_number)];
  }
  if (row.action === 'pos.order_type_changed') {
    return [first(details.from, details.old_type), first(details.to, details.new_type)];
  }
  if (context.old_cost !== undefined || context.new_cost !== undefined) {
    return [scalar(context.old_cost), scalar(context.new_cost)];
  }
  if (context.old_role !== undefined || context.new_role !== undefined) {
    return [scalar(context.old_role), scalar(context.new_role)];
  }
  const oldQty = first(context.old_qty, context.previous_qty, details.old_qty);
  if (oldQty !== null) return [oldQty, first(context.new_qty, details.qty)];
  const key = context.key ?? context.field;
  if (auditIsSecretKey(key)) return [null, null];
  if (row.action === 'setting.update') return [scalar(context.old), scalar(context.new)];
  if (typeof context.field === 'string') return [scalar(context.before), scalar(context.after)];
  return [null, null];
}

function outcome(row: AuditLogRow, details: Record<string, unknown>): AuditFields['outcome'] {
  if (row.action === 'pos.payment_completed' || row.action === 'login.success' || row.action === 'manager_pin.verified') return 'success';
  if (row.action === 'pos.payment_failed' || row.action === 'login.failed' || row.action === 'manager_pin.failed') return 'failed';
  const reported = row.action === 'pos.cash_drawer_opened' ? details.opened
    : row.action === 'pos.receipt_printed' || row.action === 'pos.receipt_reprinted' ? details.printed
      : undefined;
  return reported === true ? 'success' : reported === false ? 'failed' : null;
}

export function auditFields(row: AuditLogRow): AuditFields {
  const context = auditRecord(row.metadata);
  const details = auditRecord(row.payload);
  const isPos = row.source === 'pos';
  const [before, after] = change(row, context, details);

  // Un motif codé et un texte libre ne vont pas dans la même case.
  const rawReason = first(context.reason, context.cancel_reason, context.discount_reason, details.reason);
  const explicitCode = first(context.reason_code, context.waste_reason_code, details.reason_code, context.waste_reason, details.waste_reason);
  const reasonIsCode = rawReason !== null && CODE.test(rawReason);
  const reasonCode = explicitCode !== null && CODE.test(explicitCode) ? explicitCode : reasonIsCode ? rawReason : null;
  const reasonNote = first(context.note, details.note, context.reason_note,
    explicitCode !== null && !CODE.test(explicitCode) ? explicitCode : null,
    rawReason !== null && !reasonIsCode ? rawReason : null);

  // Le tiroir porte la monnaie rendue, pas le montant de la vente : pas de montant ici.
  const amount = row.action === 'pos.cash_drawer_opened' ? null
    : auditNumber(context.total ?? context.amount ?? context.total_amount ?? context.items_total
      ?? details.amount ?? details.total_amount);

  return {
    orderNumber: first(context.order_number),
    orderId: ORDER_ENTITIES.has(row.entity_type) ? row.entity_id : first(context.order_id),
    terminalId: first(context.device_id, context.terminal_id) ?? (row.entity_type === 'pos_device' ? row.entity_id : null),
    // `session_id` d'une connexion désigne la session du compte, pas le poste de caisse.
    shiftId: SHIFT_ENTITIES.has(row.entity_type) ? row.entity_id
      : first(context.shift_id, context.receiving_session_id, isPos || row.action.startsWith('order.') ? context.session_id : null),
    table: first(details.table_number, context.table_number),
    product: first(details.name, details.product_name, context.product_name, context.item_name),
    productId: PRODUCT_ENTITIES.has(row.entity_type) ? row.entity_id : first(context.product_id, details.product_id),
    quantity: auditNumber(context.new_qty ?? details.qty ?? context.quantity ?? details.quantity ?? context.quantity_produced),
    unit: first(context.unit),
    amount,
    paymentMethod: paymentMethod(context, details),
    before,
    after,
    reasonCode,
    reasonNote,
    outcome: outcome(row, details),
  };
}

export interface OrderLinks {
  numberById: Map<string, string>;
  idByNumber: Map<string, string>;
}

/** Relie identifiant et numéro de commande à partir des lignes qui portent les deux. */
export function buildOrderLinks(rows: readonly AuditLogRow[]): OrderLinks {
  const numberById = new Map<string, string>();
  const idByNumber = new Map<string, string>();
  for (const row of rows) {
    const { orderId, orderNumber } = auditFields(row);
    if (orderId === null || orderNumber === null) continue;
    if (!numberById.has(orderId)) numberById.set(orderId, orderNumber);
    if (!idByNumber.has(orderNumber)) idByNumber.set(orderNumber, orderId);
  }
  return { numberById, idByNumber };
}

/** Complète la moitié manquante du couple commande, puis donne la clé de lien. */
export function linkAuditFields(fields: AuditFields, links: OrderLinks): AuditFields & { linkKey: string | null } {
  const orderNumber = fields.orderNumber ?? (fields.orderId === null ? null : links.numberById.get(fields.orderId) ?? null);
  const orderId = fields.orderId ?? (fields.orderNumber === null ? null : links.idByNumber.get(fields.orderNumber) ?? null);
  const order = orderNumber ?? orderId;
  const linkKey = order !== null ? `order:${order}` : fields.shiftId !== null ? `shift:${fields.shiftId}` : null;
  return { ...fields, orderNumber, orderId, linkKey };
}
