// packages/domain/src/production/types.ts
// Session 13 — Phase 2.A — Production + Recipes types (pure TS, IO-free).

export interface RecipeRow {
  recipe_id: string;
  product_id: string;
  product_name: string;
  product_unit: string;
  material_id: string;
  material_name: string;
  material_unit: string;
  material_cost_price: number;
  quantity: number;
  unit: string;
  is_active: boolean;
  notes: string | null;
}

export interface ExpandedRecipeRow {
  material_id: string;
  material_name: string;
  /** Quantity expressed in the **recipe unit** (e.g. grams). */
  quantity_in_recipe_unit: number;
  recipe_unit: string;
  /** Quantity expressed in the **material's stock unit** (e.g. kilograms). */
  quantity_in_material_unit: number;
  material_unit: string;
  /** Cost contribution = material_cost_price * quantity_in_material_unit (per batch). */
  cost: number;
}

export interface BomCostResult {
  /** Total material cost for the produced batch (sum across rows). */
  total_cost: number;
  /** Per-unit material cost = total_cost / quantity_produced. */
  unit_cost: number;
  /** Per-row breakdown. */
  rows: ExpandedRecipeRow[];
}

export interface FeasibilityResult {
  feasible: boolean;
  missing: Array<{
    material_id: string;
    material_name: string;
    required: number;
    available: number;
    shortfall: number;
    unit: string;
  }>;
}
