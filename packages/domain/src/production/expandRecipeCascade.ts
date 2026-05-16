// packages/domain/src/production/expandRecipeCascade.ts
// Session 16 — Phase 2.C — leaf-only recursive cascade walker.
//
// Walks a RecipeGraph from `productId` and accumulates only LEAF materials
// (skips sub-recipe intermediates). Reuses the cycle/depth-cap semantics of
// `recipeCostCalculator` so client preview matches server-side cascade.
//
// Returns a Map keyed by material_id with aggregate {qty, name, unit}.
// `qty` is measured in the MATERIAL's stock unit (graph.products[matId].unit).
// We do NOT apply unit conversion in the client preview (mirrors D7 — identity
// conversion). If recipe-unit ≠ material-unit, the SERVER cascade is the
// source of truth ; the preview will be approximate.

import {
  RecipeCycleError,
  RecipeDepthExceededError,
  type RecipeGraph,
  type RecipeGraphRow,
} from './recipeCostCalculator.js';

export interface CascadeLeaf {
  qty:  number;
  name: string;
  unit: string;
}

export interface ExpandRecipeCascadeOptions {
  /** Hard cap on recursion depth. Defaults to 5 (matches DB cascade). */
  maxDepth?: number;
}

const DEFAULT_MAX_DEPTH = 5;

function indexRowsByProduct(rows: readonly RecipeGraphRow[]): Map<string, RecipeGraphRow[]> {
  const map = new Map<string, RecipeGraphRow[]>();
  for (const r of rows) {
    const bucket = map.get(r.product_id);
    if (bucket) bucket.push(r);
    else map.set(r.product_id, [r]);
  }
  return map;
}

interface WalkCtx {
  graph: RecipeGraph;
  rowsByProduct: Map<string, RecipeGraphRow[]>;
  maxDepth: number;
  out: Map<string, CascadeLeaf>;
}

function walk(
  ctx: WalkCtx,
  productId: string,
  multiplier: number,
  depth: number,
  ancestors: Set<string>,
  path: string[],
): void {
  if (depth > ctx.maxDepth) {
    throw new RecipeDepthExceededError(depth);
  }
  const rows = ctx.rowsByProduct.get(productId) ?? [];
  for (const row of rows) {
    const isRecipe = ctx.rowsByProduct.has(row.material_id);
    if (isRecipe) {
      if (ancestors.has(row.material_id)) {
        throw new RecipeCycleError([...path, row.material_id]);
      }
      ancestors.add(row.material_id);
      path.push(row.material_id);
      try {
        walk(ctx, row.material_id, multiplier * row.quantity, depth + 1, ancestors, path);
      } finally {
        ancestors.delete(row.material_id);
        path.pop();
      }
    } else {
      const product = ctx.graph.products[row.material_id];
      if (!product) {
        throw new Error(
          `Material ${row.material_id} referenced by ${productId} is missing from graph.products`,
        );
      }
      const qty = multiplier * row.quantity;
      const existing = ctx.out.get(row.material_id);
      if (existing !== undefined) {
        existing.qty += qty;
      } else {
        ctx.out.set(row.material_id, { qty, name: product.name, unit: product.unit });
      }
    }
  }
}

export function expandRecipeCascade(
  graph: RecipeGraph,
  productId: string,
  multiplier: number,
  opts: ExpandRecipeCascadeOptions = {},
): Map<string, CascadeLeaf> {
  const ctx: WalkCtx = {
    graph,
    rowsByProduct: indexRowsByProduct(graph.recipes),
    maxDepth: opts.maxDepth ?? DEFAULT_MAX_DEPTH,
    out: new Map<string, CascadeLeaf>(),
  };
  walk(ctx, productId, multiplier, 1, new Set([productId]), [productId]);
  return ctx.out;
}
