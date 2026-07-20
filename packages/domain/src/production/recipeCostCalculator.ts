// packages/domain/src/production/recipeCostCalculator.ts
// Session 15 — Phase 1.B — Recursive recipe cost calculator (pure TS).
//
// Client-side preview of the cost cascade implemented by the DB RPC
// `calculate_recipe_cost_v1(p_product_id, p_max_depth)`. This module is
// IO-free and is intended to be used by RecipeEditor / IngredientPicker /
// RecipeCostPreviewCard to render a live preview without a round-trip.
//
// Decisions :
// - D2 (Spec 2026-05-15): mirrors RPC payload shape (cost_per_unit,
//   breakdown[] with sub_breakdown, depth_reached, has_cycle).
// - D7 (Spec 2026-05-15): unit-conversion is a no-op by default for the
//   client preview (the DB-side `convert_quantity()` does the full matrix).
//   Callers may inject a `convertUnit` hook to mimic the DB conversion
//   table; otherwise quantities are treated as already-aligned.
// - Hard `maxDepth = 5` mirrors the DB hard cap to keep parity with
//   `calculate_recipe_cost_v1` and the anti-cycle trigger.

export interface RecipeGraphProduct {
  id: string;
  name: string;
  /** Stock unit for `cost_price` (e.g. 'kg', 'pcs', 'L'). */
  unit: string;
  /** Cost per 1 unit of the product (leaf). DECIMAL(14,2) on DB side. */
  cost_price: number;
}

export interface RecipeGraphRow {
  /** Product whose recipe this row belongs to. */
  product_id: string;
  /** Material consumed by the recipe row (may itself be a recipe product). */
  material_id: string;
  /** Quantity per 1 unit of `product_id`, in `unit`. DECIMAL(10,3) on DB side. */
  quantity: number;
  /** Free-form recipe unit (e.g. 'g', 'kg', 'mL'). */
  unit: string;
}

export interface RecipeGraph {
  /** All products keyed by id. Materials referenced by `recipes` MUST exist here. */
  products: Record<string, RecipeGraphProduct>;
  /** ALL active recipe rows. The calculator filters by `product_id`. */
  recipes: RecipeGraphRow[];
}

export interface RecipeCostBreakdownItem {
  material_id: string;
  material_name: string;
  /** `true` iff `material_id` itself has at least one row in `graph.recipes`. */
  is_recipe: boolean;
  /** Quantity required per 1 unit of the parent product, in MATERIAL's unit. */
  qty_per_unit: number;
  /** Cost per 1 material unit (leaf `cost_price` or recursive `cost_per_unit`). */
  unit_cost: number;
  /** `qty_per_unit × unit_cost`. */
  subtotal: number;
  /** Present iff `is_recipe === true`. */
  sub_breakdown?: RecipeCostBreakdownItem[];
}

export interface RecipeCostBreakdown {
  product_id: string;
  cost_per_unit: number;
  breakdown: RecipeCostBreakdownItem[];
  /** Max depth actually reached during DFS (0 = leaf, 1 = direct, …). */
  depth_reached: number;
  /**
   * Always `false` from {@link calculateRecipeCost} — that variant throws on
   * cycle. Reserved for callers that swallow `RecipeCycleError` and prefer a
   * flagged result (e.g. {@link tryCalculateRecipeCost}).
   */
  has_cycle: boolean;
}

export interface CalculateRecipeCostOptions {
  /** Hard cap on recursion depth. Defaults to 5 (matches DB RPC). */
  maxDepth?: number;
  /**
   * Optional unit converter. Mirrors the DB `convert_quantity(qty, from, to)`
   * helper. Defaults to identity — see D7. Supply this from
   * `recipeExpansion.unitConversionFactor` if recipe-unit ≠ material-unit
   * coverage is needed in the preview.
   */
  convertUnit?: (qty: number, from: string, to: string) => number;
}

export class RecipeCycleError extends Error {
  constructor(public path: string[]) {
    super(`Recipe cycle detected: ${path.join(' -> ')}`);
    this.name = 'RecipeCycleError';
  }
}

export class RecipeDepthExceededError extends Error {
  constructor(public depth: number) {
    super(`Recipe depth exceeded: ${depth}`);
    this.name = 'RecipeDepthExceededError';
  }
}

const DEFAULT_MAX_DEPTH = 5;
const identityConvert = (qty: number): number => qty;

/**
 * Index recipe rows by `product_id` once so that DFS is O(rows + edges) rather
 * than O(rows × depth). Materials whose `product_id` is absent from this map
 * are leaves.
 */
function indexRowsByProduct(
  recipes: readonly RecipeGraphRow[],
): Map<string, RecipeGraphRow[]> {
  const map = new Map<string, RecipeGraphRow[]>();
  for (const row of recipes) {
    const bucket = map.get(row.product_id);
    if (bucket) {
      bucket.push(row);
    } else {
      map.set(row.product_id, [row]);
    }
  }
  return map;
}

interface WalkContext {
  products: Record<string, RecipeGraphProduct>;
  rowsByProduct: Map<string, RecipeGraphRow[]>;
  maxDepth: number;
  convertUnit: (qty: number, from: string, to: string) => number;
  /** Running max of `depth_reached` across the walk. */
  maxObservedDepth: number;
}

interface WalkResult {
  cost_per_unit: number;
  breakdown: RecipeCostBreakdownItem[];
}

/**
 * Recursive worker. `ancestors` is a Set for O(1) cycle membership ; `path`
 * is the ordered array used for `RecipeCycleError.path`.
 */
function walk(
  ctx: WalkContext,
  productId: string,
  depth: number,
  ancestors: Set<string>,
  path: string[],
): WalkResult {
  if (depth > ctx.maxDepth) {
    throw new RecipeDepthExceededError(depth);
  }
  if (depth > ctx.maxObservedDepth) {
    ctx.maxObservedDepth = depth;
  }

  const rows = ctx.rowsByProduct.get(productId) ?? [];
  const breakdown: RecipeCostBreakdownItem[] = [];
  let cost_per_unit = 0;

  for (const row of rows) {
    const material = ctx.products[row.material_id];
    if (!material) {
      throw new Error(
        `Material ${row.material_id} referenced by product ${productId} ` +
          `is missing from graph.products`,
      );
    }

    const isRecipe = ctx.rowsByProduct.has(row.material_id);

    // Convert the recipe-row quantity into the material's stock unit so that
    // `qty_per_unit × unit_cost` carries consistent dimensions. Default
    // `convertUnit` is identity (see D7).
    const qty_per_unit = ctx.convertUnit(row.quantity, row.unit, material.unit);

    let unit_cost: number;
    let sub_breakdown: RecipeCostBreakdownItem[] | undefined;

    if (isRecipe) {
      const nextMaterialId = row.material_id;
      if (ancestors.has(nextMaterialId)) {
        throw new RecipeCycleError([...path, nextMaterialId]);
      }
      ancestors.add(nextMaterialId);
      path.push(nextMaterialId);
      try {
        const sub = walk(ctx, nextMaterialId, depth + 1, ancestors, path);
        unit_cost = sub.cost_per_unit;
        sub_breakdown = sub.breakdown;
      } finally {
        ancestors.delete(nextMaterialId);
        path.pop();
      }
    } else {
      unit_cost = material.cost_price;
    }

    const subtotal = qty_per_unit * unit_cost;
    cost_per_unit += subtotal;

    const item: RecipeCostBreakdownItem = {
      material_id: row.material_id,
      material_name: material.name,
      is_recipe: isRecipe,
      qty_per_unit,
      unit_cost,
      subtotal,
    };
    if (sub_breakdown !== undefined) {
      item.sub_breakdown = sub_breakdown;
    }
    breakdown.push(item);
  }

  return { cost_per_unit, breakdown };
}

/**
 * Compute the recursive material cost for one unit of `productId`. Mirrors
 * the DB RPC `calculate_recipe_cost_v1` for client-side preview.
 *
 * Throws :
 * - `Error` if `productId` is missing from `graph.products` (or a referenced
 *   `material_id` is missing).
 * - {@link RecipeCycleError} if the recipe graph contains a cycle reachable
 *   from `productId`.
 * - {@link RecipeDepthExceededError} if recursion exceeds `maxDepth`
 *   (default 5).
 *
 * Note (D7) : `opts.convertUnit` defaults to identity. The DB-side helper
 * does the full matrix via `convert_quantity()`. Inject
 * {@link unitConversionFactor}-based wrappers if you need parity.
 */
export function calculateRecipeCost(
  graph: RecipeGraph,
  productId: string,
  opts?: CalculateRecipeCostOptions,
): RecipeCostBreakdown {
  const product = graph.products[productId];
  if (!product) {
    throw new Error(`Product ${productId} not found in graph.products`);
  }

  const maxDepth = opts?.maxDepth ?? DEFAULT_MAX_DEPTH;
  if (!Number.isInteger(maxDepth) || maxDepth < 1) {
    throw new Error('maxDepth must be a positive integer');
  }

  const ctx: WalkContext = {
    products: graph.products,
    rowsByProduct: indexRowsByProduct(graph.recipes),
    maxDepth,
    convertUnit: opts?.convertUnit ?? identityConvert,
    maxObservedDepth: 0,
  };

  const ancestors = new Set<string>([productId]);
  const path: string[] = [productId];
  const result = walk(ctx, productId, 0, ancestors, path);

  return {
    product_id: productId,
    cost_per_unit: result.cost_per_unit,
    breakdown: result.breakdown,
    depth_reached: ctx.maxObservedDepth,
    has_cycle: false,
  };
}

export type TryCalculateRecipeCostResult =
  | { ok: true; value: RecipeCostBreakdown }
  | { ok: false; error: RecipeCycleError | RecipeDepthExceededError | Error };

/**
 * Non-throwing variant for UI surfaces that want to render a cycle/depth
 * warning instead of an exception (e.g. RecipeEditor preview card).
 *
 * On `RecipeCycleError`, the returned `error` carries the offending `path`.
 * Unknown errors are surfaced as-is with `ok: false`.
 */
export function tryCalculateRecipeCost(
  graph: RecipeGraph,
  productId: string,
  opts?: CalculateRecipeCostOptions,
): TryCalculateRecipeCostResult {
  try {
    return { ok: true, value: calculateRecipeCost(graph, productId, opts) };
  } catch (err) {
    if (
      err instanceof RecipeCycleError ||
      err instanceof RecipeDepthExceededError
    ) {
      return { ok: false, error: err };
    }
    return { ok: false, error: err instanceof Error ? err : new Error(String(err)) };
  }
}
