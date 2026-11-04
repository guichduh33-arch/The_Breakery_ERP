import { formatIdrFull } from './chartColors.js';
import type { AuditLogRow } from '../hooks/useAuditLogs.js';

const ACTIONS: Record<string, string> = {
  'order.reopened': 'Order reopened',
  'order.pay_existing': 'Existing order paid',
  'order.complete': 'Sale completed',
  'order.held': 'Order put on hold',
  'order.fire_appended': 'Items added and sent to the kitchen',
  'order.cancel_unpaid': 'Unpaid order cancelled',
  'order.cancel_item': 'Order item cancelled',
  'order.refund': 'Order refunded',
  'order.offline_fire_replayed': 'Offline kitchen order synchronised',
  'order.sellability_tolerated': 'Existing order accepted with unavailable items',
  'kds.preparation_started': 'Kitchen preparation started',
  'kds.item_served': 'Item marked as served',
  'shift.open': 'Cash register opened',
  'shift.close': 'Cash register closed',
  'login.success': 'Signed in successfully',
  'login.failed': 'Sign-in failed',
  logout: 'Signed out',
  'pos.order_opened': 'New order started',
  'pos.item_added': 'Item added to the cart',
  'pos.item_qty_changed': 'Item quantity changed',
  'pos.item_removed_pre_fire': 'Item removed before kitchen dispatch',
  'pos.item_voided_post_fire': 'Item voided after kitchen dispatch',
  'pos.order_type_changed': 'Order type changed',
  'pos.table_assigned': 'Table assigned',
  'pos.table_transferred': 'Order moved to another table',
  'pos.note_added': 'Order note updated',
  'pos.sent_to_kitchen': 'Order sent to the kitchen',
  'pos.kitchen_bumped': 'Kitchen item marked ready',
  'pos.kitchen_recalled': 'Kitchen item recalled',
  'pos.order_held': 'Order put on hold',
  'pos.order_resumed': 'Order resumed',
  'pos.payment_started': 'Payment started',
  'pos.payment_method_selected': 'Payment method selected',
  'pos.payment_completed': 'Payment completed',
  'pos.payment_failed': 'Payment failed',
  'pos.change_given': 'Cash change given',
  'pos.receipt_printed': 'Receipt printed',
  'pos.receipt_reprinted': 'Receipt reprinted',
  'pos.cash_drawer_opened': 'Cash drawer opened',
  'pos.paid_in': 'Cash added to the drawer',
  'pos.paid_out': 'Cash removed from the drawer',
  'pos.manager_pin_used': 'Manager authorised an action',
  'pos.login': 'Signed in on the POS',
  'pos.logout': 'Signed out of the POS',
  'pos.device_switch': 'POS device changed',
  'pos.offline_intent_quarantined': 'Offline operation requires review',
};

const VERBS: Record<string, string> = {
  insert: 'created', create: 'created', update: 'updated', delete: 'deleted', approve: 'approved',
  reject: 'rejected', cancel: 'cancelled', submit: 'submitted',
  activate: 'activated', deactivate: 'deactivated', acknowledge: 'acknowledged',
};

function record(value: unknown): Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

function words(value: string): string {
  return value.replace(/[._-]+/g, ' ');
}

export function auditActorName(row: AuditLogRow): string {
  const name = row.actor_name?.trim();
  if (name) return name;
  return row.actor_id === null ? 'System' : 'Former or unavailable user';
}

export function auditActionLabel(action: string): string {
  const parts = action.replace(/^pos\./, '').split('.');
  const last = parts.pop() ?? action;
  const label = ACTIONS[action] ?? words([...parts, VERBS[last] ?? last].join(' '));
  return label.charAt(0).toUpperCase() + label.slice(1);
}

/** Résumé fondé uniquement sur les valeurs présentes dans la trace. */
export function describeAuditLog(row: AuditLogRow): string {
  const context = record(row.metadata);
  const details = record(row.payload);
  const reference = context.order_number ?? context.name ?? details.name;
  const amount = context.total ?? context.amount;
  const reason = context.reason;
  const parts = [auditActionLabel(row.action)];
  if (typeof reference === 'string' && reference.trim()) parts.push(reference);
  if (typeof amount === 'number' && Number.isFinite(amount)) parts.push(formatIdrFull(amount));
  if (typeof details.qty === 'number') parts.push(`Quantity ${details.qty}`);
  if (typeof reason === 'string' && reason.trim()) parts.push(reason);
  return parts.join(' · ');
}
