// packages/domain/src/reports/__tests__/aggregations.test.ts
import { describe, it, expect } from 'vitest';
import {
  sumByHour,
  sumByCategory,
  sumByStaff,
  computeStockVariance,
} from '../aggregations.js';

describe('sumByHour', () => {
  it('zero-fills all 24 hours when input is empty', () => {
    const out = sumByHour([]);
    expect(out).toHaveLength(24);
    expect(out.every((b) => b.total === 0 && b.order_count === 0)).toBe(true);
  });

  it('accumulates totals and counts per hour', () => {
    const out = sumByHour([
      { paid_at_local_hour:  8, total: 10_000 },
      { paid_at_local_hour:  8, total: 5_000 },
      { paid_at_local_hour: 14, total: 25_000 },
    ]);
    expect(out[8]).toEqual({ hour:  8, total: 15_000, order_count: 2 });
    expect(out[14]).toEqual({ hour: 14, total: 25_000, order_count: 1 });
    expect(out[0]).toEqual({ hour:  0, total: 0,      order_count: 0 });
  });

  it('ignores out-of-range hours', () => {
    const out = sumByHour([{ paid_at_local_hour: 99, total: 1_000 }]);
    expect(out.every((b) => b.total === 0)).toBe(true);
  });
});

describe('sumByCategory', () => {
  it('aggregates lines per category and sorts by total desc', () => {
    const out = sumByCategory([
      { category_id: 'a', category_name: 'Bread',    line_total: 20_000, quantity: 4 },
      { category_id: 'b', category_name: 'Beverage', line_total: 50_000, quantity: 5 },
      { category_id: 'a', category_name: 'Bread',    line_total: 10_000, quantity: 2 },
    ]);
    expect(out).toHaveLength(2);
    expect(out[0]?.category_id).toBe('b');
    expect(out[0]?.total).toBe(50_000);
    expect(out[1]?.category_id).toBe('a');
    expect(out[1]?.total).toBe(30_000);
    expect(out[1]?.qty).toBe(6);
  });
});

describe('sumByStaff', () => {
  it('aggregates orders per staff with avg basket', () => {
    const out = sumByStaff([
      { staff_id: 's1', staff_name: 'Alice', total: 100_000 },
      { staff_id: 's1', staff_name: 'Alice', total: 50_000 },
      { staff_id: 's2', staff_name: 'Bob',   total: 30_000 },
    ]);
    expect(out).toHaveLength(2);
    const alice = out.find((s) => s.staff_id === 's1');
    expect(alice).toEqual({
      staff_id: 's1', staff_name: 'Alice', total: 150_000,
      order_count: 2, avg_basket: 75_000,
    });
    const bob = out.find((s) => s.staff_id === 's2');
    expect(bob?.avg_basket).toBe(30_000);
  });
});

describe('computeStockVariance', () => {
  it('computes opened/sold/adjusted/variance per product', () => {
    const out = computeStockVariance([
      { product_id: 'p1', product_name: 'Croissant', movement_type: 'purchase',   quantity: 100, current_qty: 0 },
      { product_id: 'p1', product_name: 'Croissant', movement_type: 'sale',       quantity: -40, current_qty: 0 },
      { product_id: 'p1', product_name: 'Croissant', movement_type: 'waste',      quantity:  -5, current_qty: 55 },
    ]);
    expect(out).toHaveLength(1);
    const p1 = out[0];
    expect(p1?.opened).toBe(100);
    expect(p1?.sold).toBe(-40);
    expect(p1?.adjusted).toBe(-5);
    expect(p1?.expected).toBe(55);
    expect(p1?.current_qty).toBe(55);
    expect(p1?.variance).toBe(0);
    expect(p1?.variance_pct).toBe(0);
  });

  it('detects a non-zero variance', () => {
    const out = computeStockVariance([
      { product_id: 'p1', product_name: 'Croissant', movement_type: 'purchase', quantity: 100, current_qty: 50 },
      { product_id: 'p1', product_name: 'Croissant', movement_type: 'sale',     quantity: -40, current_qty: 50 },
    ]);
    expect(out[0]?.expected).toBe(60);
    expect(out[0]?.variance).toBe(-10);
    expect(out[0]?.variance_pct).toBeCloseTo(-16.666, 2);
  });
});
