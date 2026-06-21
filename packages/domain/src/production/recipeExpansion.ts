// packages/domain/src/production/recipeExpansion.ts
// Session 13 — Phase 2.A — Recipe expansion helper.
//
// Expands a recipe (per-unit ingredient list) by a batch multiplier and
// converts each line into the material's stock unit. Pure TS — mirrors
// the DB-side `convert_quantity()` function's coverage matrix.
//
// Supported unit pairs (case-insensitive after trim) :
//   g  ↔ kg   (×0.001 / ×1000)        — 'gr' is an accepted alias of 'g'
//   mg ↔ g    (×0.001 / ×1000)
//   mg ↔ kg   (×0.000001 / ×1000000)
//   mL ↔ L    (×0.001 / ×1000)        — 'lt' is an accepted alias of 'l'
//   pcs ↔ pcs (×1)
// Same-unit pair is always ×1.
//
// Units-registry note (PR #103): the central units registry made 'gr' the
// canonical mass token and 'lt' a litre alias, so recipe lines now spell mass
// as 'gr'. This table mirrors DB migration 20260630000018 so the front-end cost
// preview converts the same pairs the DB convert_quantity() does — otherwise a
// 'gr' line on a 'kg' material threw and the cost card showed "—".
//
// Throws `UnknownUnitConversionError` for unsupported pairs so consumers can
// surface a clear UI error instead of silently miscounting.

import type { RecipeRow, ExpandedRecipeRow } from './types.js';

export class UnknownUnitConversionError extends Error {
  constructor(public from: string, public to: string) {
    super(`Unknown unit conversion: ${from} → ${to}`);
    this.name = 'UnknownUnitConversionError';
  }
}

const norm = (u: string): string => u.trim().toLowerCase();

const TABLE: Record<string, number> = {
  // Same unit (lowercased)
  'g:g': 1, 'kg:kg': 1, 'mg:mg': 1, 'ml:ml': 1, 'l:l': 1, 'pcs:pcs': 1,
  'gr:gr': 1, 'lt:lt': 1,
  // Mass
  'g:kg': 0.001, 'kg:g': 1000,
  'mg:g': 0.001, 'g:mg': 1000,
  'mg:kg': 0.000001, 'kg:mg': 1000000,
  // Mass — 'gr' alias of gram (units registry / migration 20260630000018)
  'gr:g': 1, 'g:gr': 1,
  'gr:kg': 0.001, 'kg:gr': 1000,
  'gr:mg': 1000, 'mg:gr': 0.001,
  // Volume
  'ml:l': 0.001, 'l:ml': 1000,
  // Volume — 'lt' alias of litre (units registry / migration 20260630000018)
  'lt:l': 1, 'l:lt': 1,
  'lt:ml': 1000, 'ml:lt': 0.001,
};

export function unitConversionFactor(fromUnit: string, toUnit: string): number {
  const key = `${norm(fromUnit)}:${norm(toUnit)}`;
  const factor = TABLE[key];
  if (factor === undefined) {
    throw new UnknownUnitConversionError(fromUnit, toUnit);
  }
  return factor;
}

/**
 * Expand a recipe by a batch multiplier (e.g. quantity_produced + quantity_waste).
 * For each row, compute the quantity consumed in both the recipe unit AND the
 * material's stock unit, plus the per-batch material cost.
 */
export function expandRecipe(
  recipe: readonly RecipeRow[],
  batchMultiplier: number,
): ExpandedRecipeRow[] {
  if (!Number.isFinite(batchMultiplier) || batchMultiplier <= 0) {
    throw new Error('batchMultiplier must be a finite positive number');
  }
  return recipe
    .filter((r) => r.is_active)
    .map((r) => {
      const qtyInRecipeUnit = r.quantity * batchMultiplier;
      const factor = unitConversionFactor(r.unit, r.material_unit);
      const qtyInMaterialUnit = qtyInRecipeUnit * factor;
      return {
        material_id: r.material_id,
        material_name: r.material_name,
        quantity_in_recipe_unit: qtyInRecipeUnit,
        recipe_unit: r.unit,
        quantity_in_material_unit: qtyInMaterialUnit,
        material_unit: r.material_unit,
        cost: qtyInMaterialUnit * r.material_cost_price,
      };
    });
}
