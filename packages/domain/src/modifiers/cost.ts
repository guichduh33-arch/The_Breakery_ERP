// packages/domain/src/modifiers/cost.ts
//
// Pure (IO-free) material-cost computation for modifier options. Mirrors the
// server resolver `_resolve_modifier_ingredients_v1` (qty × factor_to_base ×
// line_qty) but multiplies by each material's cost_price instead of returning
// the deducted quantity. Used by the Backoffice modifiers editor to surface the
// COGS impact of each option — the cost is "variable" precisely when sibling
// options deduct different materials or quantities (e.g. Oat milk vs Fresh).

import type { ModifierIngredient } from './types.js';

/** Minimal material shape needed to value an ingredient line. */
export interface ModifierCostMaterial {
  cost_price: number | null;
  /** base unit (factor 1) ∪ alternatives, as exposed by useAllProductsForPO. */
  unitOptions: { code: string; factor: number }[];
}

/**
 * Cost of a single ingredient deduction line, in IDR, for ONE unit of the
 * parent product (line_qty = 1). The unit is converted to the material's base
 * unit via factor_to_base, mirroring the server resolver. Returns null when the
 * material or its cost_price is unknown — the caller renders an indeterminate
 * cost rather than a misleading 0.
 */
export function modifierIngredientLineCost(
  ingredient: ModifierIngredient,
  material: ModifierCostMaterial | undefined,
): number | null {
  if (!material || material.cost_price == null) return null;
  const factor =
    material.unitOptions.find((u) => u.code === ingredient.unit)?.factor ?? 1;
  return ingredient.qty * factor * material.cost_price;
}

/**
 * Total material cost of one modifier option = Σ of its ingredient line costs.
 * Lines whose material/cost is unknown are skipped (contribute 0); `complete`
 * is false whenever at least one such line was skipped, so the caller can flag
 * the total as a lower bound. An option with no ingredients costs 0 (complete).
 */
export function modifierOptionMaterialCost(
  ingredients: ModifierIngredient[],
  materialsById: Map<string, ModifierCostMaterial>,
): { total: number; complete: boolean } {
  let total = 0;
  let complete = true;
  for (const ing of ingredients) {
    const line = modifierIngredientLineCost(ing, materialsById.get(ing.product_id));
    if (line === null) {
      complete = false;
      continue;
    }
    total += line;
  }
  return { total, complete };
}
