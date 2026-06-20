// packages/domain/src/modifiers/__tests__/cost.test.ts

import { describe, it, expect } from 'vitest';
import {
  modifierIngredientLineCost,
  modifierOptionMaterialCost,
  type ModifierCostMaterial,
} from '../cost.js';
import type { ModifierIngredient } from '../types.js';

const OAT: ModifierCostMaterial = {
  cost_price: 50, // per base unit (e.g. per ml)
  unitOptions: [
    { code: 'ml', factor: 1 },
    { code: 'lt', factor: 1000 },
  ],
};

const SYRUP: ModifierCostMaterial = {
  cost_price: 200,
  unitOptions: [{ code: 'pump', factor: 1 }],
};

describe('modifierIngredientLineCost', () => {
  it('costs a base-unit line as qty × cost_price', () => {
    const ing: ModifierIngredient = { product_id: 'oat', qty: 30, unit: 'ml' };
    expect(modifierIngredientLineCost(ing, OAT)).toBe(30 * 50);
  });

  it('applies factor_to_base for an alternative unit', () => {
    // 0.03 lt × 1000 (ml/lt) × 50 IDR/ml = 1500
    const ing: ModifierIngredient = { product_id: 'oat', qty: 0.03, unit: 'lt' };
    expect(modifierIngredientLineCost(ing, OAT)).toBeCloseTo(1500, 6);
  });

  it('defaults factor to 1 when the unit is not in unitOptions', () => {
    const ing: ModifierIngredient = { product_id: 'oat', qty: 2, unit: 'unknown' };
    expect(modifierIngredientLineCost(ing, OAT)).toBe(2 * 50);
  });

  it('returns null when the material is unknown', () => {
    const ing: ModifierIngredient = { product_id: 'ghost', qty: 1, unit: 'ml' };
    expect(modifierIngredientLineCost(ing, undefined)).toBeNull();
  });

  it('returns null when cost_price is null', () => {
    const ing: ModifierIngredient = { product_id: 'oat', qty: 1, unit: 'ml' };
    expect(
      modifierIngredientLineCost(ing, { ...OAT, cost_price: null }),
    ).toBeNull();
  });
});

describe('modifierOptionMaterialCost', () => {
  const materials = new Map<string, ModifierCostMaterial>([
    ['oat', OAT],
    ['syrup', SYRUP],
  ]);

  it('sums all ingredient line costs (complete)', () => {
    const ings: ModifierIngredient[] = [
      { product_id: 'oat', qty: 30, unit: 'ml' },   // 1500
      { product_id: 'syrup', qty: 2, unit: 'pump' }, // 400
    ];
    expect(modifierOptionMaterialCost(ings, materials)).toEqual({
      total: 1900,
      complete: true,
    });
  });

  it('an option with no ingredients costs 0 and is complete', () => {
    expect(modifierOptionMaterialCost([], materials)).toEqual({
      total: 0,
      complete: true,
    });
  });

  it('skips unpriceable lines and flags complete=false (lower bound)', () => {
    const ings: ModifierIngredient[] = [
      { product_id: 'oat', qty: 30, unit: 'ml' }, // 1500
      { product_id: 'ghost', qty: 5, unit: 'ml' }, // unknown → skipped
    ];
    expect(modifierOptionMaterialCost(ings, materials)).toEqual({
      total: 1500,
      complete: false,
    });
  });
});
