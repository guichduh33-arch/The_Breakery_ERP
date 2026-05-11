// packages/domain/src/inventory/computeNewStock.ts
// Session 12 — pure arithmetic for projecting a new stock level.
//
// Intentionally does NOT assert non-negativity: the server is authoritative
// and may legitimately persist a negative stock (e.g. concurrent oversell that
// later triggers a reconciliation). UI validators (validateAdjust / validateWaste)
// already enforce the non-negative invariant where required.

/**
 * Project the new stock level after applying a signed delta.
 *
 * @param current      The current stock value.
 * @param signedDelta  Positive (IN) or negative (OUT) delta.
 * @returns            The projected new stock value.
 */
export function computeNewStock(current: number, signedDelta: number): number {
  return current + signedDelta;
}
