// packages/domain/src/refunds/__tests__/computeRefund.test.ts

import { describe, expect, it } from 'vitest';
import { computeRefundLineAmount, computeRefundTax, computeRefundTotal } from '../computeRefund.js';
import type { RefundableItem } from '../types.js';

const item = (overrides: Partial<RefundableItem> = {}): RefundableItem => ({
  order_item_id: 'oi-1',
  quantity: 2,
  line_total: 30_000,
  qty_already_refunded: 0,
  is_cancelled: false,
  ...overrides,
});

describe('computeRefundLineAmount', () => {
  it('returns 0 for zero qty parent', () => {
    expect(computeRefundLineAmount(item({ quantity: 0 }), 0)).toBe(0);
  });
  it('full qty refunds the line_total', () => {
    expect(computeRefundLineAmount(item({ quantity: 2, line_total: 30_000 }), 2)).toBe(30_000);
  });
  it('half qty refunds half (rounded to IDR)', () => {
    expect(computeRefundLineAmount(item({ quantity: 2, line_total: 30_000 }), 1)).toBe(15_000);
  });
  it('rounds odd math to nearest 100 IDR', () => {
    // 33333 * 1 / 3 = 11111 → roundIdr → 11100
    expect(computeRefundLineAmount(item({ quantity: 3, line_total: 33_333 }), 1)).toBe(11_100);
  });
});

describe('computeRefundTotal', () => {
  it('NaN when an item is missing', () => {
    const map = new Map([['a', item({ order_item_id: 'a' })]]);
    expect(Number.isNaN(computeRefundTotal([{ order_item_id: 'b', qty: 1 }], map))).toBe(true);
  });
  it('sums per-line', () => {
    const map = new Map([
      ['a', item({ order_item_id: 'a', quantity: 2, line_total: 20_000 })],
      ['b', item({ order_item_id: 'b', quantity: 1, line_total: 50_000 })],
    ]);
    expect(computeRefundTotal([
      { order_item_id: 'a', qty: 1 },  // 10_000
      { order_item_id: 'b', qty: 1 },  // 50_000
    ], map)).toBe(60_000);
  });
});

describe('computeRefundTax (PB1 inclusive 10%)', () => {
  it('extracts PB1 from inclusive total', () => {
    // 110_000 inclusive → tax = 110000 * 0.10 / 1.10 = 10000
    expect(computeRefundTax(110_000)).toBe(10_000);
  });
  it('rounds to IDR', () => {
    // 11_000 inclusive → tax = 11000 * 0.10 / 1.10 = 1000
    expect(computeRefundTax(11_000)).toBe(1_000);
  });
});
