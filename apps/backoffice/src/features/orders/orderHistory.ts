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

// Chaque action d'audit qu'une migration ou l'EF refund-order émet sur une
// commande a son libellé : un geste sensible sans nom (« Order activity »)
// contredisait le principe « chaque geste sensible porte un nom ». La table
// était aussi fausse sur une clé : la base émet `order.complete`, jamais
// `order.completed`. Le test `order-history-labels` la confronte aux sources.
export const ORDER_HISTORY_LABELS: Readonly<Record<string, string>> = {
  'order.fire_appended': 'Items added at POS',
  'order.tablet_appended': 'Items added from tablet',
  'order.offline_fire_replayed': 'Offline items synchronized',
  'order.item.add': 'Item added',
  'order.item.update_qty': 'Item quantity changed',
  'order.item.remove': 'Item removed',
  'order.pay_existing': 'Payment recorded',
  // ADR-046 : le super admin corrige le moyen d'un règlement.
  'order.payment_method_corrected': 'Payment method corrected',
  // Fin d'encaissement en caisse (`complete_order`) : distincte des lignes
  // « Payment completed » tirées de chaque paiement, d'où un autre libellé.
  'order.complete': 'Checkout completed',
  'order.outstanding_created': 'Left outstanding on customer account',
  'order.outstanding_payment': 'Outstanding balance paid',
  'order.attach_tab_customer': 'Customer attached',
  'order.price_overridden': 'Price overridden',
  'order.sellability_tolerated': 'Unsellable items accepted',
  'order.combo_price_tolerated': 'Combo price accepted unverified',
  'order.held': 'Order put on hold',
  'order.reopened': 'Order reopened',
  'order.held_discarded': 'Held order discarded',
  'order.held_restored': 'Held order restored',
  'order.close_cancelled_tablet': 'Cancelled tablet order closed',
  'order.refund': 'Refund recorded',
  'refund.replay': 'Refund request repeated (no new refund)',
  'order.void_store_credit_orphan': 'Store credit not restored (no customer)',
  'je.payment_fallback_cash': 'Payment reversal booked as cash',
  'pos.receipt.lookup': 'Receipt looked up at POS',
  'order.void': 'Order voided',
  'order.cancel_unpaid': 'Unpaid order voided',
  'order.item_cancelled': 'Item cancelled',
  'order.item.cancel': 'Item cancelled',
  'order.cancel_item': 'Item cancellation authorized',
  'order.table_transfer': 'Table changed',
  'order.discount_applied': 'Discount authorized',
  'order.picked_up': 'Order picked up',
  'kds.preparation_started': 'Preparation started',
  'kds.item_served': 'Item served',
  'kds.bump_item': 'Item ready',
  'kds.bump_order': 'Kitchen items ready',
  'kds.undo_bump': 'Ready status undone',
  'kds.recall': 'Order recalled to kitchen',
  'kds.offline_replayed': 'Kitchen update synchronized',
  'b2b.order.created': 'B2B order created',
  'b2b.order.edited': 'B2B order edited',
  'b2b.order.cancelled': 'B2B order cancelled',
  'b2b.order.delivered': 'B2B order collected',
  'b2b.order.pickup_updated': 'Pickup date changed',
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
    // Quand le trigger d'activité a tracé le geste, sa ligne d'audit (qui porte
    // l'acteur) remplace la ligne déduite de la colonne : pas de doublon.
    if (!itemAudit.some((event) => event.action === 'kds.preparation_started')) {
      add(`prep-${item.id}`, 'Preparation started', item.prep_started_at, null, detail);
    }
    if (!itemAudit.some((event) => event.action === 'kds.bump_item')) {
      add(`ready-${item.id}`, 'Item ready', item.ready_at, null, detail);
    }
    if (!itemAudit.some((event) => event.action === 'kds.item_served')) {
      add(`served-${item.id}`, 'Item served', item.served_at, item.served_by_name ?? null, detail);
    }
    add(`cancelled-${item.id}`, 'Item cancelled', item.cancelled_at, item.cancelled_by_name ?? null, detail);
  }
  for (const payment of order.payments) add(`payment-${payment.id}`, 'Payment completed', payment.paid_at, null, payment.method);
  if (!order.payments.length) add('paid', 'Paid', order.paid_at);
  add('voided', 'Voided', order.history?.voidedAt, order.history?.voidedByName ?? null);
  // Le remboursement prend le nom de qui l'a autorisé depuis sa trace
  // `order.refund` ; cette trace n'est alors pas répétée plus bas.
  const mergedAudit = new Set<number>();
  for (const refund of order.refunds) {
    const trace = audit.find((event) => event.action === 'order.refund' && auditMetadata(event).refund_id === refund.id);
    if (trace) mergedAudit.add(trace.id);
    add(`refund-${refund.id}`, 'Refund recorded', refund.created_at, trace?.actor?.full_name ?? null, refund.refund_number, trace?.participants);
  }
  for (const event of audit) {
    if (mergedAudit.has(event.id)) continue;
    const metadata = auditMetadata(event);
    const itemId = typeof metadata.order_item_id === 'string' ? metadata.order_item_id : event.entity_id;
    const item = order.items.find((line) => line.id === itemId);
    const count = metadata.items_added ?? metadata.items_count;
    const detail = item ? `${item.name_snapshot}${typeof metadata.qty === 'number' ? ` × ${metadata.qty}` : ''}`
      : typeof count === 'number' ? `${count} item lines`
        // Une correction de moyen se lit par son motif ; le moyen courant est sur le règlement.
        : event.action === 'order.payment_method_corrected' && typeof metadata.reason === 'string' ? metadata.reason
          : undefined;
    // Repli : le code brut plutôt qu'un générique qui cache le geste.
    add(`audit-${event.id}`, ORDER_HISTORY_LABELS[event.action] ?? `Recorded action: ${event.action}`, event.created_at, event.actor?.full_name ?? null, detail, event.participants);
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
