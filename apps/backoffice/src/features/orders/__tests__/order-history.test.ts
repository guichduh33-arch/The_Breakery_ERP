import { describe, expect, it } from 'vitest';
import { buildOrderHistory, type OrderAuditEvent } from '../orderHistory.js';
import type { OrderDetail } from '../hooks/useOrderDetail.js';

const order: OrderDetail = {
  id: 'order-1', order_number: 'T-001', status: 'pending_payment', order_type: 'dine_in',
  table_number: '1', created_at: '2026-11-03T01:00:00Z', paid_at: null,
  sent_to_kitchen_at: '2026-11-03T01:00:00Z', customer_id: null, customer_name: null,
  served_by: 'cashier-1', served_by_name: 'Current cashier', subtotal: 50_000,
  discount_amount: 0, tax_amount: 0, total: 50_000, items: [], payments: [], refunds: [],
  promotions: [], refunded_by_method: {}, total_refunded: 0,
  history: { createdVia: 'tablet', waiterName: 'Alice Waiter', voidedAt: null, voidedByName: null },
};
const item = {
  id: 'item-1', product_id: 'product-1', name_snapshot: 'Croissant', quantity: 2,
  unit_price: 25_000, line_total: 50_000, modifiers: [], is_cancelled: false,
  kitchen_status: 'served', qty_already_refunded: 0,
  created_at: '2026-11-03T01:10:00Z', prep_started_at: '2026-11-03T01:11:00Z',
  ready_at: '2026-11-03T01:12:00Z', served_at: '2026-11-03T01:13:00Z', served_by_name: 'Bob Waiter',
};
function event(overrides: Partial<OrderAuditEvent> = {}): OrderAuditEvent {
  return {
    id: 1, action: 'order.tablet_appended', actor_id: 'waiter-2', entity_id: order.id,
    created_at: '2026-11-03T01:10:00Z', metadata: { items_added: 2 }, actor: { full_name: 'Carol Waiter' },
    ...overrides,
  };
}

describe('Order history from recorded facts', () => {
  it('attributes tablet creation to the original waiter and never to the current cashier', () => {
    const result = buildOrderHistory(order, []);
    expect(result.find((entry) => entry.id === 'created')).toMatchObject({ person: 'Alice Waiter', at: order.created_at });
    expect(result.some((entry) => entry.person === 'Current cashier')).toBe(false);
    const legacyOrder = { ...order };
    delete legacyOrder.history;
    expect(buildOrderHistory(legacyOrder, [])[0]!.person).toBeNull();
  });

  it('shows successive POS and tablet additions with their own actor, time and count', () => {
    const result = buildOrderHistory(order, [
      event({ id: 2, action: 'order.fire_appended', created_at: '2026-11-03T01:20:00Z', metadata: { items_count: 1 }, actor: { full_name: 'Dan Cashier' } }),
      event(),
    ]);
    expect(result.filter((entry) => entry.id.startsWith('audit-'))).toEqual([
      expect.objectContaining({ label: 'Items added from tablet', person: 'Carol Waiter', at: '2026-11-03T01:10:00Z', detail: '2 item lines' }),
      expect.objectContaining({ label: 'Items added at POS', person: 'Dan Cashier', at: '2026-11-03T01:20:00Z', detail: '1 item lines' }),
    ]);
  });

  it('shows item addition, preparation, readiness and service at their recorded times', () => {
    const result = buildOrderHistory({ ...order, items: [item] }, []);
    expect(result).toEqual(expect.arrayContaining([
      expect.objectContaining({ label: 'Item added', at: item.created_at, detail: 'Croissant' }),
      expect.objectContaining({ label: 'Preparation started', at: item.prep_started_at, person: null }),
      expect.objectContaining({ label: 'Item ready', at: item.ready_at }),
      expect.objectContaining({ label: 'Item served', at: item.served_at, person: 'Bob Waiter' }),
    ]));
  });

  it('does not present a reduced current quantity as the original quantity added', () => {
    const result = buildOrderHistory({ ...order, items: [{ ...item, quantity: 1 }] }, [event()]);
    expect(result.find((entry) => entry.id === 'added-item-1')).toMatchObject({ detail: 'Croissant' });
    expect(result.find((entry) => entry.id === 'added-item-1')!.detail).not.toContain('× 1');
  });

  it('uses an item addition audit to name the actor and avoids duplicating that addition', () => {
    const result = buildOrderHistory({ ...order, items: [item] }, [event({
      action: 'order.item.add', metadata: { order_item_id: item.id, qty: 2 }, actor: { full_name: 'Owner' },
    })]);
    expect(result.filter((entry) => entry.label === 'Item added')).toEqual([
      expect.objectContaining({ person: 'Owner', detail: 'Croissant × 2' }),
    ]);
  });

  it('preserves the operator and authorizer as distinct participants', () => {
    const result = buildOrderHistory(order, [event({ action: 'order.cancel_item', actor: { full_name: 'Manager' }, participants: ['Performed by: Alice Waiter'] })]);
    expect(result.find((entry) => entry.id === 'audit-1')).toMatchObject({
      person: 'Manager', participants: ['Performed by: Alice Waiter'], label: 'Item cancellation authorized',
    });
  });

  it('marks missing legacy void times explicitly and does not invent a completed time', () => {
    expect(buildOrderHistory({ ...order, status: 'voided' }, []).at(-1)).toMatchObject({ label: 'Voided', at: null, person: null });
    expect(buildOrderHistory({ ...order, status: 'completed' }, []).at(-1)).toMatchObject({ label: 'Completed', at: null });
  });

  it('sorts timestamps by instant even when their timezone offsets differ', () => {
    const result = buildOrderHistory(order, [
      event({ id: 1, created_at: '2026-11-03T09:05:00+08:00' }),
      event({ id: 2, created_at: '2026-11-03T01:10:00Z' }),
    ]);
    expect(result.filter((entry) => entry.id.startsWith('audit-')).map((entry) => entry.id)).toEqual(['audit-1', 'audit-2']);
  });
});
