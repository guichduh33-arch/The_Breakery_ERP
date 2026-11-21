// Règles partagées tiroir / page détail (audit Sales 2026-11-21) : statuts
// éditables, void payé, remboursement, prix unitaire effectif.
import { describe, expect, it } from 'vitest';
import {
  effectiveUnitPrice,
  isEditableStatus,
  isOrderRefundable,
  isVoidablePaidStatus,
  type OrderRefundFacts,
} from '../statusMeta.js';

const LINE = { is_cancelled: false, line_total: 50_000, quantity: 2, qty_already_refunded: 0 };
const PAID: OrderRefundFacts = {
  status: 'paid', total: 50_000, total_refunded: 0, loyalty_points_redeemed: 0, items: [LINE],
  customer_id: null, payments: [{ method: 'qris', amount: 50_000 }], refunded_by_method: {},
};
const CASH_WALK_IN: OrderRefundFacts = { ...PAID, payments: [{ method: 'cash', amount: 50_000 }] };

describe('order action rules', () => {
  it('editable and paid-voidable statuses are disjoint', () => {
    expect(['draft', 'pending_payment'].every(isEditableStatus)).toBe(true);
    expect(['paid', 'completed'].every(isVoidablePaidStatus)).toBe(true);
    for (const s of ['paid', 'completed', 'voided', 'b2b_pending']) expect(isEditableStatus(s)).toBe(false);
    for (const s of ['draft', 'pending_payment', 'voided', 'b2b_pending']) expect(isVoidablePaidStatus(s)).toBe(false);
  });

  it('refund is offered while money remains on a paid or completed order', () => {
    expect(isOrderRefundable(PAID, false)).toBe(true);
    expect(isOrderRefundable({ ...PAID, status: 'completed', total_refunded: 20_000 }, false)).toBe(true);
    expect(isOrderRefundable({ ...PAID, total_refunded: 50_000 }, false)).toBe(false);
    expect(isOrderRefundable({ ...PAID, status: 'voided' }, false)).toBe(false);
    expect(isOrderRefundable({ ...PAID, status: 'pending_payment' }, false)).toBe(false);
  });

  it('refund stays open for loyalty points left on unrefunded quantities', () => {
    const order = { ...PAID, total_refunded: 50_000, loyalty_points_redeemed: 10, items: [{ ...LINE, qty_already_refunded: 1 }] };
    expect(isOrderRefundable(order, false)).toBe(true);
    expect(isOrderRefundable({ ...order, items: [{ ...LINE, qty_already_refunded: 2 }] }, false)).toBe(false);
  });

  it('refund is hidden when the back-office has nowhere to send the money', () => {
    // Vente cash sans client : ni moyen non-cash, ni avoir possible → caisse.
    expect(isOrderRefundable(CASH_WALK_IN, false)).toBe(false);
    expect(isOrderRefundable({ ...CASH_WALK_IN, loyalty_points_redeemed: 10 }, false)).toBe(false);
    // Un client rattaché ouvre l'avoir ; un reste non-cash ouvre son tender.
    expect(isOrderRefundable({ ...CASH_WALK_IN, customer_id: 'c-1' }, false)).toBe(true);
    expect(isOrderRefundable({ ...PAID, refunded_by_method: { qris: 20_000 }, total_refunded: 20_000 }, false)).toBe(true);
    expect(isOrderRefundable({ ...PAID, refunded_by_method: { qris: 50_000 }, total_refunded: 20_000 }, false)).toBe(false);
  });

  it('a pending refund attempt is always reachable', () => {
    expect(isOrderRefundable({ ...CASH_WALK_IN, total_refunded: 0 }, true)).toBe(true);
    expect(isOrderRefundable({ ...PAID, status: 'voided', total_refunded: 50_000 }, true)).toBe(true);
  });

  it('effective unit price includes modifiers and is rounded to the rupiah', () => {
    expect(effectiveUnitPrice({ line_total: 56_000, quantity: 2, unit_price: 25_000 })).toBe(28_000);
    expect(effectiveUnitPrice({ line_total: 10_000, quantity: 3, unit_price: 3_000 })).toBe(3_333);
    expect(effectiveUnitPrice({ line_total: 0, quantity: 0, unit_price: 7_000 })).toBe(7_000);
  });
});
