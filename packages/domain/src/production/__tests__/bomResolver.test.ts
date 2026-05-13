// packages/domain/src/production/__tests__/bomResolver.test.ts
// Session 13 — Phase 2.A — BoM resolver unit tests.

import { describe, it, expect } from 'vitest';
import { bomCost, checkFeasibility } from '../bomResolver.js';
import type { RecipeRow } from '../types.js';

function row(overrides: Partial<RecipeRow>): RecipeRow {
  return {
    recipe_id: 'r', product_id: 'p', product_name: 'Baguette', product_unit: 'pcs',
    material_id: 'm', material_name: 'Flour', material_unit: 'kg',
    material_cost_price: 10000, quantity: 250, unit: 'g',
    is_active: true, notes: null,
    ...overrides,
  };
}

describe('bomCost', () => {
  it('sums per-row costs to total_cost and divides by produced for unit_cost', () => {
    const recipe: RecipeRow[] = [
      row({ material_id: 'flour', quantity: 250, unit: 'g', material_unit: 'kg', material_cost_price: 10000 }),
      row({ material_id: 'salt',  quantity: 5,   unit: 'g', material_unit: 'kg', material_cost_price: 5000 }),
    ];
    const result = bomCost(recipe, 50);
    // flour: 12.5kg × 10000 = 125000
    // salt:   0.25kg × 5000  =   1250
    expect(result.total_cost).toBe(126_250);
    expect(result.unit_cost).toBe(2_525);
    expect(result.rows).toHaveLength(2);
  });

  it('throws on non-positive quantityProduced', () => {
    expect(() => bomCost([], 0)).toThrow();
    expect(() => bomCost([], -1)).toThrow();
  });
});

describe('checkFeasibility', () => {
  it('returns feasible=true when stock covers requirements', () => {
    const recipe: RecipeRow[] = [
      row({ material_id: 'flour', quantity: 250, unit: 'g', material_unit: 'kg' }),
    ];
    const result = checkFeasibility(recipe, 50, { flour: 100 });
    expect(result.feasible).toBe(true);
    expect(result.missing).toHaveLength(0);
  });

  it('returns feasible=false with detailed missing list when stock short', () => {
    const recipe: RecipeRow[] = [
      row({ material_id: 'flour', quantity: 250, unit: 'g',  material_unit: 'kg', material_name: 'Flour' }),
      row({ material_id: 'water', quantity: 150, unit: 'mL', material_unit: 'L',  material_name: 'Water' }),
    ];
    const result = checkFeasibility(recipe, 50, { flour: 5, water: 100 });
    expect(result.feasible).toBe(false);
    expect(result.missing).toHaveLength(1);
    expect(result.missing[0]!.material_name).toBe('Flour');
    expect(result.missing[0]!.required).toBe(12.5);
    expect(result.missing[0]!.available).toBe(5);
    expect(result.missing[0]!.shortfall).toBe(7.5);
    expect(result.missing[0]!.unit).toBe('kg');
  });

  it('includes waste in the required quantity computation', () => {
    const recipe: RecipeRow[] = [
      row({ material_id: 'flour', quantity: 250, unit: 'g', material_unit: 'kg' }),
    ];
    // Produced 50 + waste 4 → 54 × 250g = 13.5kg ; stock 13 → shortfall 0.5
    const result = checkFeasibility(recipe, 50, { flour: 13 }, 4);
    expect(result.feasible).toBe(false);
    expect(result.missing[0]!.required).toBe(13.5);
    expect(result.missing[0]!.shortfall).toBe(0.5);
  });

  it('treats missing material from stock map as 0 available', () => {
    const recipe: RecipeRow[] = [
      row({ material_id: 'unknown', quantity: 1, unit: 'g', material_unit: 'kg' }),
    ];
    const result = checkFeasibility(recipe, 1, {});
    expect(result.feasible).toBe(false);
    expect(result.missing[0]!.available).toBe(0);
  });
});
