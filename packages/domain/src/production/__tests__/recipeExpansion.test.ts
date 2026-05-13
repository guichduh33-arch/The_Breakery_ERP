// packages/domain/src/production/__tests__/recipeExpansion.test.ts
// Session 13 — Phase 2.A — Recipe expansion unit tests.

import { describe, it, expect } from 'vitest';
import {
  unitConversionFactor,
  expandRecipe,
  UnknownUnitConversionError,
} from '../recipeExpansion.js';
import type { RecipeRow } from '../types.js';

function makeRow(overrides: Partial<RecipeRow>): RecipeRow {
  return {
    recipe_id: overrides.recipe_id ?? 'r-1',
    product_id: overrides.product_id ?? 'p-1',
    product_name: overrides.product_name ?? 'Baguette',
    product_unit: overrides.product_unit ?? 'pcs',
    material_id: overrides.material_id ?? 'm-1',
    material_name: overrides.material_name ?? 'Flour',
    material_unit: overrides.material_unit ?? 'kg',
    material_cost_price: overrides.material_cost_price ?? 10000,
    quantity: overrides.quantity ?? 250,
    unit: overrides.unit ?? 'g',
    is_active: overrides.is_active ?? true,
    notes: overrides.notes ?? null,
  };
}

describe('unitConversionFactor', () => {
  it.each([
    ['g', 'kg', 0.001],
    ['kg', 'g', 1000],
    ['mg', 'g', 0.001],
    ['mg', 'kg', 0.000001],
    ['kg', 'mg', 1_000_000],
    ['mL', 'L', 0.001],
    ['L', 'mL', 1000],
    ['pcs', 'pcs', 1],
    ['kg', 'kg', 1],
    ['Kg', 'KG', 1],   // case-insensitive
  ])('%s → %s = %s', (from, to, expected) => {
    expect(unitConversionFactor(from, to)).toBe(expected);
  });

  it('throws UnknownUnitConversionError for unsupported pairs', () => {
    expect(() => unitConversionFactor('tablespoon', 'kg'))
      .toThrow(UnknownUnitConversionError);
    expect(() => unitConversionFactor('g', 'mL'))
      .toThrow(UnknownUnitConversionError);
  });
});

describe('expandRecipe', () => {
  it('multiplies quantities by batch size and converts to material unit', () => {
    const recipe: RecipeRow[] = [
      makeRow({ quantity: 250, unit: 'g', material_unit: 'kg', material_id: 'flour' }),
      makeRow({ quantity: 150, unit: 'mL', material_unit: 'L', material_id: 'water' }),
    ];
    const expanded = expandRecipe(recipe, 50);
    expect(expanded).toHaveLength(2);
    const flour = expanded.find((r) => r.material_id === 'flour')!;
    const water = expanded.find((r) => r.material_id === 'water')!;
    expect(flour.quantity_in_recipe_unit).toBe(12_500);
    expect(flour.quantity_in_material_unit).toBeCloseTo(12.5, 6);
    expect(water.quantity_in_material_unit).toBeCloseTo(7.5, 6);
  });

  it('filters out inactive rows', () => {
    const recipe: RecipeRow[] = [
      makeRow({ material_id: 'a', is_active: true }),
      makeRow({ material_id: 'b', is_active: false }),
    ];
    const expanded = expandRecipe(recipe, 1);
    expect(expanded).toHaveLength(1);
    expect(expanded[0]!.material_id).toBe('a');
  });

  it('throws on non-positive batch multiplier', () => {
    expect(() => expandRecipe([], 0)).toThrow();
    expect(() => expandRecipe([], -1)).toThrow();
    expect(() => expandRecipe([], Number.NaN)).toThrow();
  });

  it('computes per-batch cost contribution', () => {
    const recipe: RecipeRow[] = [
      makeRow({
        quantity: 250, unit: 'g', material_unit: 'kg',
        material_cost_price: 10_000, material_id: 'flour',
      }),
    ];
    const expanded = expandRecipe(recipe, 50);
    // 50 × 250g = 12.5kg ; cost = 12.5 × 10,000 = 125,000 IDR
    expect(expanded[0]!.cost).toBe(125_000);
  });
});
