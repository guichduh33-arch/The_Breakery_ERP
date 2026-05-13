// packages/domain/src/production/bomResolver.ts
// Session 13 — Phase 2.A — BoM cost resolver + feasibility check.
//
// Pure-TS helpers used by BO RecipeEditor (cost preview) and
// ProductionForm (live feasibility badge).

import type { RecipeRow, BomCostResult, FeasibilityResult } from './types.js';
import { expandRecipe } from './recipeExpansion.js';

/**
 * Compute the material cost for producing `quantityProduced` units of a
 * product whose recipe is `recipe`. Includes a per-unit cost breakdown.
 */
export function bomCost(
  recipe: readonly RecipeRow[],
  quantityProduced: number,
): BomCostResult {
  if (!Number.isFinite(quantityProduced) || quantityProduced <= 0) {
    throw new Error('quantityProduced must be a finite positive number');
  }
  const rows = expandRecipe(recipe, quantityProduced);
  const total_cost = rows.reduce((acc, r) => acc + r.cost, 0);
  const unit_cost = total_cost / quantityProduced;
  return { total_cost, unit_cost, rows };
}

/**
 * Check whether the current per-material stock can sustain the production of
 * `quantityProduced` (+ optional `quantityWaste`) units. Returns a feasibility
 * verdict + the list of missing items if not feasible.
 *
 * `stockByMaterialId` is a snapshot map of material_id → current_stock (in
 * the material's stock unit).
 */
export function checkFeasibility(
  recipe: readonly RecipeRow[],
  quantityProduced: number,
  stockByMaterialId: Record<string, number>,
  quantityWaste = 0,
): FeasibilityResult {
  if (!Number.isFinite(quantityProduced) || quantityProduced <= 0) {
    throw new Error('quantityProduced must be a finite positive number');
  }
  if (!Number.isFinite(quantityWaste) || quantityWaste < 0) {
    throw new Error('quantityWaste must be a finite non-negative number');
  }
  const rows = expandRecipe(recipe, quantityProduced + quantityWaste);
  const missing: FeasibilityResult['missing'] = [];
  for (const r of rows) {
    const available = stockByMaterialId[r.material_id] ?? 0;
    if (available < r.quantity_in_material_unit) {
      missing.push({
        material_id: r.material_id,
        material_name: r.material_name,
        required: r.quantity_in_material_unit,
        available,
        shortfall: r.quantity_in_material_unit - available,
        unit: r.material_unit,
      });
    }
  }
  return { feasible: missing.length === 0, missing };
}
