// packages/domain/src/inventory/__tests__/landedCostAllocation.test.ts

import { describe, expect, it } from 'vitest';
import {
  calculateLandedCostAllocation,
  type PoLineForAllocation,
} from '../landedCostAllocation.js';

describe('calculateLandedCostAllocation', () => {
  it('by_value happy path — 3 equal lines split shipping evenly', () => {
    const lines: PoLineForAllocation[] = [
      { po_item_id: 'a', quantity: 10, unit_cost: 100, product_weight_grams: null },
      { po_item_id: 'b', quantity: 10, unit_cost: 100, product_weight_grams: null },
      { po_item_id: 'c', quantity: 10, unit_cost: 100, product_weight_grams: null },
    ];
    const result = calculateLandedCostAllocation(lines, 300, 'by_value');

    expect(result).toHaveLength(3);
    for (const r of result) {
      expect(r.allocation_share).toBeCloseTo(1 / 3, 10);
      expect(r.shipping_share).toBeCloseTo(100, 10);
      expect(r.base_unit_cost).toBe(100);
      expect(r.landed_unit_cost).toBeCloseTo(110, 10);
      expect(r.method_used).toBe('by_value');
      expect(r.fallback_reason).toBeNull();
    }
  });

  it('by_weight happy path — splits by quantity*weight', () => {
    const lines: PoLineForAllocation[] = [
      { po_item_id: 'a', quantity: 2, unit_cost: 50, product_weight_grams: 100 },
      { po_item_id: 'b', quantity: 4, unit_cost: 50, product_weight_grams: 50 },
      { po_item_id: 'c', quantity: 1, unit_cost: 50, product_weight_grams: 250 },
    ];
    const result = calculateLandedCostAllocation(lines, 300, 'by_weight');

    // metrics = [200, 200, 250] -> total 650
    expect(result[0]!.allocation_share).toBeCloseTo(200 / 650, 10);
    expect(result[1]!.allocation_share).toBeCloseTo(200 / 650, 10);
    expect(result[2]!.allocation_share).toBeCloseTo(250 / 650, 10);

    expect(result[0]!.shipping_share).toBeCloseTo(300 * (200 / 650), 10);
    expect(result[1]!.shipping_share).toBeCloseTo(300 * (200 / 650), 10);
    expect(result[2]!.shipping_share).toBeCloseTo(300 * (250 / 650), 10);

    for (const r of result) {
      expect(r.method_used).toBe('by_weight');
      expect(r.fallback_reason).toBeNull();
    }
  });

  it('by_quantity happy path — shipping/qty equalizes per-unit landed cost when shipping is proportional', () => {
    const lines: PoLineForAllocation[] = [
      { po_item_id: 'a', quantity: 10, unit_cost: 100, product_weight_grams: null },
      { po_item_id: 'b', quantity: 20, unit_cost: 200, product_weight_grams: null },
      { po_item_id: 'c', quantity: 30, unit_cost: 300, product_weight_grams: null },
    ];
    const result = calculateLandedCostAllocation(lines, 600, 'by_quantity');

    expect(result[0]!.allocation_share).toBeCloseTo(10 / 60, 10);
    expect(result[1]!.allocation_share).toBeCloseTo(20 / 60, 10);
    expect(result[2]!.allocation_share).toBeCloseTo(30 / 60, 10);

    expect(result[0]!.shipping_share).toBeCloseTo(100, 10);
    expect(result[1]!.shipping_share).toBeCloseTo(200, 10);
    expect(result[2]!.shipping_share).toBeCloseTo(300, 10);

    // shipping_share / quantity = 10 for each line
    expect(result[0]!.landed_unit_cost).toBeCloseTo(110, 10);
    expect(result[1]!.landed_unit_cost).toBeCloseTo(210, 10);
    expect(result[2]!.landed_unit_cost).toBeCloseTo(310, 10);

    for (const r of result) {
      expect(r.method_used).toBe('by_quantity');
      expect(r.fallback_reason).toBeNull();
    }
  });

  it('falls back to by_value when ALL lines lack weight (by_weight requested)', () => {
    const lines: PoLineForAllocation[] = [
      { po_item_id: 'a', quantity: 10, unit_cost: 100, product_weight_grams: null },
      { po_item_id: 'b', quantity: 10, unit_cost: 100, product_weight_grams: null },
      { po_item_id: 'c', quantity: 10, unit_cost: 100, product_weight_grams: null },
    ];
    const result = calculateLandedCostAllocation(lines, 300, 'by_weight');

    for (const r of result) {
      expect(r.method_used).toBe('by_value');
      expect(r.fallback_reason).toBe('no_weight_on_3_lines');
      expect(r.allocation_share).toBeCloseTo(1 / 3, 10);
      expect(r.landed_unit_cost).toBeCloseTo(110, 10);
    }
  });

  it('falls back globally when only ONE line lacks weight (by_weight requested)', () => {
    const lines: PoLineForAllocation[] = [
      { po_item_id: 'a', quantity: 2, unit_cost: 100, product_weight_grams: 100 },
      { po_item_id: 'b', quantity: 4, unit_cost: 100, product_weight_grams: null },
      { po_item_id: 'c', quantity: 1, unit_cost: 100, product_weight_grams: 250 },
    ];
    const result = calculateLandedCostAllocation(lines, 300, 'by_weight');

    for (const r of result) {
      expect(r.method_used).toBe('by_value');
      expect(r.fallback_reason).toBe('no_weight_on_1_lines');
    }
    // by_value metrics = [200, 400, 100] total 700
    expect(result[0]!.allocation_share).toBeCloseTo(200 / 700, 10);
    expect(result[1]!.allocation_share).toBeCloseTo(400 / 700, 10);
    expect(result[2]!.allocation_share).toBeCloseTo(100 / 700, 10);
  });

  it('shipping_cost = 0 — landed equals base, shipping_share = 0, share still defined', () => {
    const lines: PoLineForAllocation[] = [
      { po_item_id: 'a', quantity: 10, unit_cost: 100, product_weight_grams: null },
      { po_item_id: 'b', quantity: 20, unit_cost: 200, product_weight_grams: null },
    ];
    const result = calculateLandedCostAllocation(lines, 0, 'by_value');

    for (const r of result) {
      expect(r.shipping_share).toBe(0);
      expect(r.landed_unit_cost).toBe(r.base_unit_cost);
      expect(r.allocation_share).toBeGreaterThan(0);
      expect(r.fallback_reason).toBeNull();
    }
  });

  it('single line — bears 100% of shipping', () => {
    const lines: PoLineForAllocation[] = [
      { po_item_id: 'solo', quantity: 5, unit_cost: 200, product_weight_grams: null },
    ];
    const result = calculateLandedCostAllocation(lines, 100, 'by_value');

    expect(result).toHaveLength(1);
    expect(result[0]!.allocation_share).toBe(1);
    expect(result[0]!.shipping_share).toBe(100);
    expect(result[0]!.landed_unit_cost).toBeCloseTo(220, 10);
    expect(result[0]!.method_used).toBe('by_value');
    expect(result[0]!.fallback_reason).toBeNull();
  });

  it('empty lines array — returns []', () => {
    const result = calculateLandedCostAllocation([], 100, 'by_value');
    expect(result).toEqual([]);
  });

  it('degenerate by_quantity (all quantities 0) — equal distribution + degenerate reason, no division', () => {
    const lines: PoLineForAllocation[] = [
      { po_item_id: 'a', quantity: 0, unit_cost: 100, product_weight_grams: null },
      { po_item_id: 'b', quantity: 0, unit_cost: 200, product_weight_grams: null },
    ];
    const result = calculateLandedCostAllocation(lines, 100, 'by_quantity');

    for (const r of result) {
      expect(r.allocation_share).toBeCloseTo(1 / 2, 10);
      expect(r.fallback_reason).toBe('degenerate_zero_metric');
      expect(r.method_used).toBe('by_quantity');
    }
    expect(result[0]!.shipping_share).toBeCloseTo(50, 10);
    expect(result[1]!.shipping_share).toBeCloseTo(50, 10);
    // quantity === 0 -> landed equals base, no division by zero
    expect(result[0]!.landed_unit_cost).toBe(100);
    expect(result[1]!.landed_unit_cost).toBe(200);
  });

  it('decimal precision — fractional quantity with by_quantity', () => {
    const lines: PoLineForAllocation[] = [
      { po_item_id: 'a', quantity: 0.333, unit_cost: 50, product_weight_grams: null },
      { po_item_id: 'b', quantity: 0.333, unit_cost: 50, product_weight_grams: null },
      { po_item_id: 'c', quantity: 0.333, unit_cost: 50, product_weight_grams: null },
    ];
    const result = calculateLandedCostAllocation(lines, 10, 'by_quantity');

    for (const r of result) {
      expect(r.allocation_share).toBeCloseTo(1 / 3, 6);
      expect(r.shipping_share).toBeCloseTo(10 / 3, 6);
      // landed = 50 + (10/3) / 0.333
      expect(r.landed_unit_cost).toBeCloseTo(50 + 10 / 3 / 0.333, 6);
    }
  });
});
