// packages/domain/src/inventory/computeStockDelta.ts
// Session 12 — sum signed quantities across an arbitrary list of movements.
// Used by movement-history views to show the net delta over a window.

import type { StockMovement } from './types.js';

export function computeStockDelta(movements: readonly StockMovement[]): number {
  let total = 0;
  for (const m of movements) {
    total += m.quantity;
  }
  return total;
}
