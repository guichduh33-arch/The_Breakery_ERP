// packages/domain/src/inventory/landedCostAllocation.ts
// Session 23 — phase 1.B.1 — pure-TS landed cost allocation (mirrors receive_po_v1 SQL logic).
//
// Allocates a single shipping_cost across N PO lines pro-rata using one of three
// methods (by_value, by_weight, by_quantity). Mirrors the server-side allocation
// performed by the `receive_po_v1` RPC so the UI can render an identical preview
// before the user commits the receive.

export type AllocationMethod = 'by_value' | 'by_weight' | 'by_quantity';

// Note: field names use snake_case to mirror the DB column names consumed by the SQL RPC
// `receive_po_v1` — keep aligned to avoid a manual mapping layer at the call sites.
export interface PoLineForAllocation {
  po_item_id: string;
  /** Expected > 0. Zero is tolerated for degenerate handling but yields no per-unit amortization. */
  quantity: number;
  /** Expected >= 0. */
  unit_cost: number;
  /** NULL = no weight registered on the product (triggers by_weight global fallback). */
  product_weight_grams: number | null;
}

export interface AllocationResult {
  po_item_id: string;
  /** Echoes the input line.unit_cost for convenience. */
  base_unit_cost: number;
  /** unit_cost + (shipping_share / quantity). Equals base_unit_cost when quantity is 0. */
  landed_unit_cost: number;
  /** Share of the shipping bill this line bears, in [0, 1]. */
  allocation_share: number;
  /** Absolute currency amount = shipping_cost * allocation_share. */
  shipping_share: number;
  /** Method actually used (may differ from the requested method when a fallback fires). */
  method_used: AllocationMethod;
  /** Non-null when a fallback occurred. Either 'no_weight_on_<N>_lines' or 'degenerate_zero_metric'. */
  fallback_reason: string | null;
}

/**
 * Allocate a shipping cost across the supplied PO lines pro-rata.
 *
 * Method selection rules:
 *   - `by_value`     -> metric = quantity * unit_cost
 *   - `by_weight`    -> metric = quantity * product_weight_grams
 *   - `by_quantity`  -> metric = quantity
 *
 * Fallback semantics (mirror SQL):
 *   1. If `method === 'by_weight'` AND >=1 line has `product_weight_grams === null`,
 *      ALL lines fall back to `by_value` for this call. `method_used` becomes
 *      `'by_value'` and `fallback_reason` is `'no_weight_on_<N>_lines'` where `<N>`
 *      is the count of NULL-weight lines.
 *   2. If the total metric sum is 0 (e.g. every quantity is 0, or by_value with
 *      every unit_cost = 0), the shipping is distributed equally (1/N per line),
 *      `fallback_reason` is set to `'degenerate_zero_metric'` (this takes
 *      priority over the by_weight reason if both would apply), AND
 *      `method_used` is reported as `'by_value'` regardless of the requested
 *      method, since equal distribution is mathematically equivalent to
 *      by_value with all-equal unit_costs.
 *
 * Per-unit guard:
 *   - When `quantity === 0`, `landed_unit_cost` is returned equal to `unit_cost`
 *     (no division by zero); the `shipping_share` is still allocated to the line.
 *
 * Empty input:
 *   - Returns `[]` (does not throw) when `lines` is empty.
 *
 * @param lines         The PO lines to allocate over.
 * @param shipping_cost The total shipping cost to distribute (>= 0).
 * @param method        The requested allocation method.
 * @returns             One `AllocationResult` per input line, in the same order.
 */
export function calculateLandedCostAllocation(
  lines: readonly PoLineForAllocation[],
  shipping_cost: number,
  method: AllocationMethod,
): AllocationResult[] {
  if (lines.length === 0) {
    return [];
  }

  // --- Step 1 : by_weight global fallback ----------------------------------
  let effectiveMethod: AllocationMethod = method;
  let weightFallbackReason: string | null = null;
  if (method === 'by_weight') {
    const nullWeightCount = lines.reduce(
      (acc, l) => (l.product_weight_grams === null ? acc + 1 : acc),
      0,
    );
    if (nullWeightCount > 0) {
      effectiveMethod = 'by_value';
      weightFallbackReason = `no_weight_on_${nullWeightCount}_lines`;
    }
  }

  // --- Step 2 : compute metrics --------------------------------------------
  const metrics = lines.map((l) => {
    if (effectiveMethod === 'by_value') {
      return l.quantity * l.unit_cost;
    }
    if (effectiveMethod === 'by_weight') {
      // Safe: post-fallback, all weights are non-null here.
      const weight = l.product_weight_grams ?? 0;
      return l.quantity * weight;
    }
    // by_quantity
    return l.quantity;
  });

  const totalMetric = metrics.reduce((acc, m) => acc + m, 0);

  // --- Step 3 : shares (with degenerate handling) --------------------------
  const N = lines.length;
  let degenerate = false;
  let shares: number[];
  if (totalMetric === 0) {
    degenerate = true;
    shares = lines.map(() => 1 / N);
  } else {
    shares = metrics.map((m) => m / totalMetric);
  }

  // Priority: degenerate beats by_weight reason.
  const finalReason: string | null = degenerate
    ? 'degenerate_zero_metric'
    : weightFallbackReason;

  // Reported method differs from the metric-computation method on degenerate:
  // an equal 1/N split is mathematically equivalent to by_value with all-equal
  // unit_costs, so we surface 'by_value' rather than the (now misleading)
  // originally-requested method. The `fallback_reason` already conveys the
  // "we couldn't use the requested method" signal.
  const reportedMethod: AllocationMethod = degenerate ? 'by_value' : effectiveMethod;

  // --- Step 4 : build results ----------------------------------------------
  return lines.map((line, i) => {
    const allocation_share = shares[i] ?? 0;
    const shipping_share = shipping_cost * allocation_share;
    const landed_unit_cost =
      line.quantity === 0 ? line.unit_cost : line.unit_cost + shipping_share / line.quantity;

    return {
      po_item_id: line.po_item_id,
      base_unit_cost: line.unit_cost,
      landed_unit_cost,
      allocation_share,
      shipping_share,
      method_used: reportedMethod,
      fallback_reason: finalReason,
    };
  });
}
