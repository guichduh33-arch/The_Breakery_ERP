// packages/domain/src/inventory/lowStockFilter.ts
// Session 12 — filter products whose current stock is strictly below the
// configured minimum threshold. Threshold === 0 means "tracking disabled".

export interface LowStockCandidate {
  currentStock: number;
  minStockThreshold: number;
}

/**
 * Returns the subset of products that are below their minimum threshold.
 *
 * A product is "low" when:
 *   - minStockThreshold > 0 (otherwise tracking is disabled), AND
 *   - currentStock < minStockThreshold (strict inequality).
 *
 * Preserves input order. Generic so callers keep their concrete row type.
 */
export function lowStockFilter<T extends LowStockCandidate>(products: readonly T[]): T[] {
  return products.filter(
    (p) => p.minStockThreshold > 0 && p.currentStock < p.minStockThreshold,
  );
}
