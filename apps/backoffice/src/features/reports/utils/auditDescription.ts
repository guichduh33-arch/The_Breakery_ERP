import { formatIdrFull } from './chartColors.js';
import type { AuditLogRow } from '../hooks/useAuditLogs.js';
import { AUDIT_ACTION_LABELS } from './auditLabels.js';
import { auditNumber, auditRecord } from './auditValues.js';

const VERBS: Record<string, string> = {
  insert: 'created', create: 'created', update: 'updated', delete: 'deleted', approve: 'approved',
  reject: 'rejected', cancel: 'cancelled', submit: 'submitted',
  activate: 'activated', deactivate: 'deactivated', acknowledge: 'acknowledged',
};

function words(value: string): string {
  return value.replace(/[._-]+/g, ' ');
}

export function auditActorName(row: AuditLogRow): string {
  const name = row.actor_name?.trim();
  if (name) return name;
  return row.actor_id === null ? 'System / actor not recorded' : 'Former or unavailable user';
}

export function auditActionLabel(action: string): string {
  const parts = action.replace(/^pos\./, '').split('.');
  const last = parts.pop() ?? action;
  const label = AUDIT_ACTION_LABELS[action] ?? words([...parts, VERBS[last] ?? last].join(' '));
  return label.charAt(0).toUpperCase() + label.slice(1);
}

/** Résumé fondé uniquement sur les valeurs présentes dans la trace. */
export function describeAuditLog(row: AuditLogRow): string {
  const context = auditRecord(row.metadata);
  const details = auditRecord(row.payload);
  const reference = context.order_number ?? context.expense_number ?? context.po_number
    ?? context.production_number ?? context.batch_number ?? context.count_number
    ?? context.payment_number ?? context.source_reference ?? context.name ?? context.item_name
    ?? details.name ?? details.product_name;
  const amount = auditNumber(context.total ?? context.amount ?? context.total_amount ?? context.items_total
    ?? details.amount ?? details.total_amount);
  const reason = context.reason ?? context.discount_reason ?? context.cancel_reason
    ?? context.waste_reason ?? details.reason;
  const parts = [auditActionLabel(row.action)];
  if (typeof reference === 'string' && reference.trim()) parts.push(reference);
  if (amount !== null) parts.push(formatIdrFull(amount));
  const oldQty = auditNumber(context.old_qty ?? context.previous_qty ?? details.old_qty);
  const qty = auditNumber(context.new_qty ?? details.qty ?? context.quantity ?? details.quantity ?? context.quantity_produced);
  if (qty !== null) parts.push(oldQty === null ? `Quantity ${qty}` : `Quantity ${oldQty} → ${qty}`);
  const unit = context.unit;
  if (qty !== null && typeof unit === 'string') parts[parts.length - 1] += ` ${unit}`;
  const waste = auditNumber(context.waste_qty ?? context.quantity_waste ?? details.waste_qty);
  if (waste !== null && waste !== 0) parts.push(`Waste quantity ${waste}`);
  if (Array.isArray(context.losses) && context.losses.length) parts.push(`Declared loss lines: ${context.losses.length}`);
  if (typeof context.movement_type === 'string') parts.push(`Movement: ${words(context.movement_type)}`);
  if (row.action === 'shift.cash_movement' && (context.direction === 'in' || context.direction === 'out')) {
    parts.push(context.direction === 'in' ? 'Cash in' : 'Cash out');
    const reasons: Record<string, string> = { apport_owner: 'Owner contribution', bank_transfer: 'Bank transfer',
      replenishment: 'Float replenishment', misc: 'Other cash movement' };
    if (typeof context.reason_code === 'string') parts.push(reasons[context.reason_code] ?? words(context.reason_code));
  }
  if (typeof context.authorized_by === 'string' && context.authorized_by) parts.push('Authorising account recorded');
  const method = context.method ?? context.payment_method ?? details.method;
  if (typeof method === 'string') parts.push(`Method: ${words(method)}`);
  const discount = auditNumber(context.order_discount_amount ?? context.discount_amount);
  if (discount !== null && discount !== 0) parts.push(`Discount ${formatIdrFull(discount)}`);
  const negotiatedPrice = row.action === 'customer_price.upserted' ? auditNumber(context.price) : null;
  if (negotiatedPrice !== null) parts.push(`Customer price ${formatIdrFull(negotiatedPrice)}`);
  const permission = details.permission_code ?? context.permission_code;
  const role = details.role_code ?? context.role_code;
  if (typeof role === 'string') parts.push(`Role: ${words(role)}`);
  if (typeof permission === 'string') parts.push(`Permission: ${permission}`);
  if (typeof details.is_granted === 'boolean') parts.push(details.is_granted ? 'Access granted' : 'Access denied');
  if (typeof context.old_role === 'string' && typeof context.new_role === 'string') {
    parts.push(`${words(context.old_role)} → ${words(context.new_role)}`);
  }
  if (row.action === 'login.failed' && auditNumber(context.attempts) !== null) parts.push(`Failed attempts: ${String(context.attempts)}`);
  if (row.action === 'manager_pin.failed' || row.action === 'manager_pin.verified') {
    if (typeof context.function === 'string') parts.push(`Operation: ${words(context.function)}`);
  }
  if (row.action === 'shift.close') {
    for (const [key, label] of [['expected_cash', 'Expected cash'], ['counted_cash', 'Counted cash'],
      ['variance', 'Cash variance'], ['variance_card', 'Card variance'], ['variance_qris', 'QRIS variance']] as const) {
      const value = auditNumber(context[key]);
      if (value !== null) parts.push(`${label} ${formatIdrFull(value)}`);
    }
  }
  const oldCost = auditNumber(context.old_cost);
  const newCost = auditNumber(context.new_cost);
  if (oldCost !== null && newCost !== null) parts.push(`Cost ${formatIdrFull(oldCost)} → ${formatIdrFull(newCost)}`);
  const points = auditNumber(details.delta);
  if (row.action === 'loyalty.adjust' && points !== null) parts.push(`${points > 0 ? '+' : ''}${points} points`);
  if (context.self_approval === true) parts.push('Self-approval exception');
  if (context.force_negative === true || context.allow_negative === true) parts.push('Negative stock override');
  if (row.action === 'expense.approved_step' && auditNumber(context.step) !== null) {
    parts.push(`Step ${String(context.step)}${auditNumber(context.of_total) === null ? '' : ` of ${String(context.of_total)}`}`);
  }
  if (typeof context.business_day === 'string') parts.push(`Business day ${context.business_day}`);
  if (row.action === 'setting.update' && typeof context.key === 'string') parts.push(`Setting: ${words(context.key)}`);
  if (row.action === 'pos.cash_drawer_opened') {
    if (typeof details.trigger === 'string') parts.push(`Trigger: ${words(details.trigger)}`);
    parts.push(details.opened === true ? 'Device reports success' : details.opened === false ? 'Device reports failure' : 'Device outcome not recorded');
  }
  if (row.action === 'pos.receipt_printed' || row.action === 'pos.receipt_reprinted') {
    parts.push(details.printed === true ? 'Device reports success' : details.printed === false ? 'Device reports failure' : 'Device outcome not recorded');
  }
  appendChanges(parts, context, details);
  if (typeof reason === 'string' && reason.trim()) parts.push(reason);
  return parts.join(' · ');
}

// Décrire seulement les champs métier connus ; ne jamais propager un secret, un hash ou une PII depuis un diff.
function appendChanges(parts: string[], context: Record<string, unknown>, details: Record<string, unknown>): void {
  const beforeDetails = auditRecord(details.before);
  const afterDetails = auditRecord(details.after);
  const before = { ...(Object.keys(beforeDetails).length ? beforeDetails : auditRecord(context.before)) };
  const after = { ...(Object.keys(afterDetails).length ? afterDetails : auditRecord(context.after)) };
  const fields: Record<string, string> = {
    retail_price: 'Retail price', cost_price: 'Cost price', credit_limit: 'Credit limit',
    payment_terms_days: 'Payment terms (days)', is_active: 'Active', visible_on_pos: 'Visible on POS',
    track_inventory: 'Track stock', deduct_stock: 'Deduct stock', status: 'Status', counted_qty: 'Counted quantity',
  };
  const field = context.field === 'price' ? 'retail_price' : context.field;
  if (typeof field === 'string' && Object.hasOwn(fields, field)) {
    if (!Object.hasOwn(before, field) && context.before !== null && typeof context.before !== 'object') before[field] = context.before;
    if (!Object.hasOwn(after, field) && context.after !== null && typeof context.after !== 'object') after[field] = context.after;
  }
  for (const [key, label] of Object.entries(fields)) {
    const previous = before[key];
    const next = Object.hasOwn(after, key) ? after[key] : details[key];
    if (next === undefined || previous === next || (next !== null && !['string', 'number', 'boolean'].includes(typeof next))) continue;
    const format = (value: unknown): string => {
      if (value === null) return 'Not set';
      const number = auditNumber(value);
      if (['retail_price', 'cost_price', 'credit_limit'].includes(key) && number !== null) return formatIdrFull(number);
      if (typeof value === 'boolean') return value ? 'Yes' : 'No';
      return typeof value === 'string' || typeof value === 'number' ? String(value) : 'Not recorded';
    };
    parts.push(`${label}: ${previous === undefined ? '' : `${format(previous)} → `}${format(next)}`);
  }
}
