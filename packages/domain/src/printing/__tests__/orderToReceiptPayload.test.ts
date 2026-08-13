// packages/domain/src/printing/__tests__/orderToReceiptPayload.test.ts
// Lot 6c — le builder de reçu est une transformation PURE : totaux NON-PKP
// (base = subtotal − PB1), exclusion des lignes annulées, promotions optionnelles.

import { describe, expect, it } from 'vitest';
import { orderToReceiptPayload, type ReceiptOrderInput } from '../orderToReceiptPayload.js';

const base = (over: Partial<ReceiptOrderInput> = {}): ReceiptOrderInput => ({
  order_number: 'ORD-001',
  created_at: '2026-05-22T10:00:00Z',
  order_type: 'dine_in',
  cashier_name: 'Jo',
  customer_name: 'Acme',
  table_number: 'A3',
  subtotal: 100_000,
  discount_amount: 0,
  tax_amount: 9_000,
  total: 100_000,
  items: [
    { name: 'Latte', quantity: 2, unit_price: 50_000, line_total: 100_000 },
  ],
  payments: [
    { method: 'card', amount: 100_000, cash_received: null, change_given: null },
  ],
  ...over,
});

describe('orderToReceiptPayload', () => {
  it('derives the NON-PKP base as subtotal − tax and echoes total/tax', () => {
    const out = orderToReceiptPayload(base());
    expect(out.totals.base).toBe(91_000);
    expect(out.totals.tax).toBe(9_000);
    expect(out.totals.total).toBe(100_000);
    expect(out.totals.discount).toBe(0);
  });

  it('excludes cancelled lines from the receipt', () => {
    const out = orderToReceiptPayload(base({
      items: [
        { name: 'Latte', quantity: 1, unit_price: 50_000, line_total: 50_000 },
        { name: 'Cake', quantity: 1, unit_price: 40_000, line_total: 40_000, is_cancelled: true },
      ],
    }));
    expect(out.items.map((i) => i.name)).toEqual(['Latte']);
  });

  it('sums promotions and omits promotion_total when there are none', () => {
    const withPromo = orderToReceiptPayload(base({
      promotions: [{ description: 'Happy hour', amount: 5_000 }, { description: 'Loyalty', amount: 2_000 }],
    }));
    expect(withPromo.totals.promotion_total).toBe(7_000);

    const noPromo = orderToReceiptPayload(base());
    expect(noPromo.totals.promotion_total).toBeUndefined();
  });

  it('carries order meta and payment split verbatim', () => {
    const out = orderToReceiptPayload(base({
      payments: [{ method: 'cash', amount: 100_000, cash_received: 120_000, change_given: 20_000 }],
    }));
    expect(out.order).toMatchObject({
      order_number: 'ORD-001', order_type: 'dine_in', cashier_name: 'Jo', customer_name: 'Acme', table_number: 'A3',
    });
    expect(out.order.date).toBe('2026-05-22T10:00:00Z');
    expect(out.payments[0]).toEqual({ method: 'cash', amount: 100_000, cash_received: 120_000, change_given: 20_000 });
  });
});
