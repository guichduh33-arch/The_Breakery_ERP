// packages/domain/src/printing/__tests__/billPayload.test.ts
// S1-21 — addition chiffrée : builders purs, montants qui se recoupent au total.

import { describe, expect, it } from 'vitest';
import type { Cart, CartItem } from '../../types/index.js';
import {
  BillReconciliationError,
  billOrderLabel,
  cartToBillPayload,
  orderToBillPayload,
  type BillOrderInput,
} from '../billPayload.js';
import type { StationTicketPayload } from '../payloads.js';

const META = { role: 'cashier' as const, created_at: '2026-11-09T10:00:00Z', server_name: 'Ayu' };

const ITEMS: CartItem[] = [
  { id: 'l1', product_id: 'p1', name: 'Latte', unit_price: 30_000, quantity: 1,
    modifiers: [{ group_name: 'Milk', option_label: 'Oat milk', price_adjustment: 5_000 }] },
  { id: 'l2', product_id: 'p2', name: 'Croissant', unit_price: 25_000, quantity: 2, modifiers: [],
    discount: { type: 'fixed_amount', value: 5_000, amount: 5_000, reason: 'Staff meal' } },
  { id: 'l3', product_id: 'p3', name: 'Breakfast combo', unit_price: 60_000, quantity: 1, modifiers: [],
    product_type: 'combo',
    combo_components: [{ name: 'Coffee', product_id: 'p4', quantity: 1,
      modifiers: [{ group_name: 'Size', option_label: 'Large', price_adjustment: 7_000 }] }] },
  { id: 'l4', product_id: 'p5', name: 'Cancelled cake', unit_price: 99_000, quantity: 1, modifiers: [], is_cancelled: true },
];

const CART: Cart = {
  items: ITEMS,
  order_type: 'dine_in',
  tableNumber: '3',
  promotionTotal: 7_000,
  loyaltyPointsToRedeem: 100, // 1 000 IDR
  cartDiscount: { type: 'fixed_amount', value: 9_000, amount: 9_000, reason: 'Regular customer' },
};

function reconcile(p: StationTicketPayload): number {
  const t = p.totals!;
  const lines = p.items.reduce((s, i) => s + (i.line_total ?? 0), 0);
  expect(lines).toBe(t.subtotal);
  return t.subtotal - (t.discount ?? 0) + (t.tax_inclusive ? 0 : t.tax);
}

describe('cartToBillPayload', () => {
  it('prices every live line, groups all discounts and reconciles with inclusive tax', () => {
    const p = cartToBillPayload(CART, 0.1, true, META);
    expect(p.kind).toBe('bill');
    expect(p.role).toBe('cashier');
    expect(p.order_number).toBe('Table 3');
    expect(p.table_number).toBe('3');
    expect(p.items.map((i) => [i.quantity, i.name, i.line_total])).toEqual([
      [1, 'Latte', 35_000],
      [2, 'Croissant', 45_000],
      [1, 'Breakfast combo', 67_000],
    ]);
    expect(p.items[0]!.modifiers).toEqual(['Oat milk']);
    expect(p.items[2]!.modifiers).toEqual(['Coffee', 'Coffee: Large']);
    expect(p.totals).toEqual({ subtotal: 147_000, discount: 17_000, tax: 11_800, tax_inclusive: true, total: 130_000 });
    expect(reconcile(p)).toBe(p.totals!.total);
    expect(p).not.toHaveProperty('payment');
  });

  it('adds the tax on top in exclusive mode and still reconciles', () => {
    const p = cartToBillPayload(CART, 0.1, false, { ...META, role: 'waiter' });
    expect(p.role).toBe('waiter');
    expect(p.totals).toEqual({ subtotal: 147_000, discount: 17_000, tax: 13_000, tax_inclusive: false, total: 143_000 });
    expect(reconcile(p)).toBe(143_000);
  });

  it('omits the discount line and labels a walk-in without a table', () => {
    const p = cartToBillPayload({ items: [ITEMS[0]!], order_type: 'take_out' }, 0.1, true, META);
    expect(p.order_number).toBe('Walk-in');
    expect(p).not.toHaveProperty('table_number');
    expect(p.totals).not.toHaveProperty('discount');
    expect(reconcile(p)).toBe(35_000);
  });

  it('uses the server line total of a persisted line', () => {
    const p = cartToBillPayload({ items: [{ ...ITEMS[0]!, server_line_total: 33_000 }], order_type: 'dine_in' }, 0.1, true, META);
    expect(p.items[0]!.line_total).toBe(33_000);
    expect(p.totals!.total).toBe(33_000);
  });
});

const ORDER: BillOrderInput = {
  order_number: 'T1-0042',
  table_number: '7',
  subtotal: 147_000,
  discount_amount: 0,
  promotion_total: 0,
  loyalty_redemption_amount: 0,
  tax_amount: 13_400,
  total: 147_000,
  items: [
    { name: 'Latte', quantity: 1, line_total: 35_000,
      modifiers: [{ group_name: 'Milk', option_label: 'Oat milk', price_adjustment: 5_000 }] },
    { name: 'Croissant', quantity: 2, line_total: 45_000, modifiers: [] },
    { name: 'Breakfast combo', quantity: 1, line_total: 67_000, modifiers: [],
      combo_components: [{ name: 'Coffee', product_id: 'p4', quantity: 1,
        modifiers: [{ group_name: 'Size', option_label: 'Large', price_adjustment: 7_000 }] }] },
    { name: 'Cancelled cake', quantity: 1, line_total: 99_000, modifiers: [], is_cancelled: true },
  ],
};

describe('orderToBillPayload', () => {
  it('prints the stored amounts, drops cancelled lines and detects inclusive tax', () => {
    const p = orderToBillPayload(ORDER, { ...META, role: 'waiter' });
    expect(p.order_number).toBe('Order T1-0042');
    expect(p.table_number).toBe('7');
    expect(p.items.map((i) => i.name)).toEqual(['Latte', 'Croissant', 'Breakfast combo']);
    expect(p.items[2]!.modifiers).toEqual(['Coffee', 'Coffee: Large']);
    expect(p.totals).toEqual({ subtotal: 147_000, tax: 13_400, tax_inclusive: true, total: 147_000 });
    expect(reconcile(p)).toBe(ORDER.total);
  });

  it('detects exclusive tax and groups promotion, loyalty and order discount', () => {
    const order: BillOrderInput = { ...ORDER, promotion_total: 7_000, loyalty_redemption_amount: 1_000,
      discount_amount: 9_000, tax_amount: 13_000, total: 143_000 };
    const p = orderToBillPayload(order, META);
    expect(p.totals).toEqual({ subtotal: 147_000, discount: 17_000, tax: 13_000, tax_inclusive: false, total: 143_000 });
    expect(reconcile(p)).toBe(143_000);
  });

  it('refuses to print when the lines do not add up to the stored subtotal', () => {
    expect(() => orderToBillPayload({ ...ORDER, subtotal: 150_000, total: 150_000 }, META))
      .toThrow(BillReconciliationError);
  });

  it('refuses to print when the stored total matches neither tax mode', () => {
    expect(() => orderToBillPayload({ ...ORDER, total: 140_000 }, META)).toThrow(BillReconciliationError);
  });

  it('reads malformed JSON modifiers defensively', () => {
    const p = orderToBillPayload({ ...ORDER, subtotal: 35_000, total: 35_000, tax_amount: 3_200,
      items: [{ name: 'Latte', quantity: 1, line_total: 35_000, modifiers: 'oops',
        combo_components: [null, 3, { modifiers: [{ option_label: 'Iced' }, { option_label: 7 }] }] }] }, META);
    expect(p.items[0]!.modifiers).toEqual(['Component', 'Component: Iced']);
  });
});

describe('billOrderLabel', () => {
  it('never prefixes a hash', () => {
    expect(billOrderLabel('A-1', '2')).toBe('Order A-1');
    expect(billOrderLabel(null, '2')).toBe('Table 2');
    expect(billOrderLabel(undefined, null)).toBe('Walk-in');
  });
});
