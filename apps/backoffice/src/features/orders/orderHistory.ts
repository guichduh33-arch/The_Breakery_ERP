import type { Json } from '@breakery/supabase';
import type { OrderDetail } from './hooks/useOrderDetail.js';
import { isOrderDetailPaid } from './statusMeta.js';

export interface OrderAuditEvent {
  id: number;
  action: string;
  actor_id: string | null;
  entity_id: string | null;
  created_at: string;
  metadata: Json | null;
  actor: { full_name: string } | null;
  participants?: string[];
}
export interface OrderHistoryEvent {
  id: string;
  label: string;
  at: string | null;
  person: string | null;
  detail?: string;
  pending?: boolean;
  participants?: string[];
}

const LABELS: Record<string, string> = {
  'order.fire_appended': 'Items added at POS',
  'order.tablet_appended': 'Items added from tablet',
  'order.item.add': 'Item added',
  'order.item.update_qty': 'Item quantity changed',
  'order.item.remove': 'Item removed',
  'order.pay_existing': 'Payment recorded',
  'order.completed': 'Payment recorded',
  'order.void': 'Order voided',
  'order.cancel_unpaid': 'Unpaid order voided',
  'order.item_cancelled': 'Item cancelled',
  'order.item.cancel': 'Item cancelled',
  'order.cancel_item': 'Item cancellation authorized',
  'order.table_transfer': 'Table changed',
  'order.discount_applied': 'Discount authorized',
  'order.picked_up': 'Order picked up',
  'kds.bump_item': 'Item ready',
  'kds.bump_order': 'Kitchen items ready',
  'kds.undo_bump': 'Ready status undone',
  'kds.recall': 'Order recalled to kitchen',
  'kds.offline_replayed': 'Kitchen update synchronized',
  'b2b.order.created': 'B2B order created',
  'b2b.order.edited': 'B2B order edited',
};

export function auditMetadata(event: OrderAuditEvent): Record<string, Json | undefined> {
  return event.metadata !== null && typeof event.metadata === 'object' && !Array.isArray(event.metadata)
    ? event.metadata : {};
}

/** Les personnes viennent de traces explicites, jamais du caissier courant. */
export function buildOrderHistory(order: OrderDetail, audit: OrderAuditEvent[]): OrderHistoryEvent[] {
  const events: OrderHistoryEvent[] = [{
    id: 'created', label: 'Created', at: order.created_at,
    person: order.history?.createdVia === 'tablet' ? order.history.waiterName : null,
  }];
  const add = (id: string, label: string, at: string | null | undefined, person: string | null = null, detail?: string, participants?: string[]): void => {
    if (at) events.push({ id, label, at, person, ...(detail ? { detail } : {}), ...(participants ? { participants } : {}) });
  };
  add('kitchen', 'Sent to kitchen', order.sent_to_kitchen_at);
  for (const item of order.items) {
    const detail = item.name_snapshot;
    const itemAudit = audit.filter((event) => event.entity_id === item.id);
    const addedAudit = audit.some((event) => event.action === 'order.item.add' && auditMetadata(event).order_item_id === item.id);
    if (item.created_at && Date.parse(item.created_at) > Date.parse(order.created_at) && !addedAudit) {
      add(`added-${item.id}`, 'Item added', item.created_at, null, detail);
    }
    add(`prep-${item.id}`, 'Preparation started', item.prep_started_at, null, detail);
    if (!itemAudit.some((event) => event.action === 'kds.bump_item')) {
      add(`ready-${item.id}`, 'Item ready', item.ready_at, null, detail);
    }
    add(`served-${item.id}`, 'Item served', item.served_at, item.served_by_name ?? null, detail);
    add(`cancelled-${item.id}`, 'Item cancelled', item.cancelled_at, item.cancelled_by_name ?? null, detail);
  }
  for (const payment of order.payments) add(`payment-${payment.id}`, 'Payment completed', payment.paid_at, null, payment.method);
  if (!order.payments.length) add('paid', 'Paid', order.paid_at);
  add('voided', 'Voided', order.history?.voidedAt, order.history?.voidedByName ?? null);
  for (const refund of order.refunds) add(`refund-${refund.id}`, 'Refund recorded', refund.created_at, null, refund.refund_number);
  for (const event of audit) {
    const metadata = auditMetadata(event);
    const itemId = typeof metadata.order_item_id === 'string' ? metadata.order_item_id : event.entity_id;
    const item = order.items.find((line) => line.id === itemId);
    const count = metadata.items_added ?? metadata.items_count;
    const detail = item ? `${item.name_snapshot}${typeof metadata.qty === 'number' ? ` × ${metadata.qty}` : ''}`
      : typeof count === 'number' ? `${count} item lines` : undefined;
    add(`audit-${event.id}`, LABELS[event.action] ?? 'Order activity', event.created_at, event.actor?.full_name ?? null, detail, event.participants);
  }
  events.sort((a, b) => Date.parse(a.at ?? '') - Date.parse(b.at ?? '') || a.id.localeCompare(b.id));
  if (order.status === 'voided' && !order.history?.voidedAt) events.push({ id: 'voided', label: 'Voided', at: null, person: null });
  if (order.status !== 'voided') {
    if (!isOrderDetailPaid(order)) events.push({ id: 'pending-payment', label: 'Payment pending', at: null, person: null, pending: true });
    else if (!order.paid_at && !order.payments.length) events.push({ id: 'paid-undated', label: 'Paid', at: null, person: null });
    events.push({ id: 'completion', label: order.status === 'completed' ? 'Completed' : 'Completion pending', at: null, person: null, pending: order.status !== 'completed' });
  }
  return events;
}
