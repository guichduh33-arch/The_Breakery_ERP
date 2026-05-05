// packages/domain/src/modifiers/calculatePriceAdjustment.ts
//
// Price helpers for cart items with modifiers.
// Spec §3.4:
//   modifiers_total_per_unit = Σ price_adjustment
//   unit_total               = unit_price + modifiers_total_per_unit
//   line_total               = unit_total × quantity

import type { SelectedModifiers } from './types.js';

/**
 * Sum of price_adjustment across selected options. May be zero.
 * Negative adjustments are *allowed* by the type but not produced by v1 seed.
 */
export function calculatePriceAdjustment(modifiers: SelectedModifiers): number {
  let total = 0;
  for (const m of modifiers) {
    total += m.price_adjustment ?? 0;
  }
  return total;
}

/**
 * Compute the line total for a cart item:
 *   (unit_price + Σ price_adjustment) × quantity
 *
 * No rounding is applied here — the caller (calculateTotals) handles IDR rounding.
 */
export function calculateLineTotal(
  unit_price: number,
  modifiers: SelectedModifiers,
  quantity: number,
): number {
  const perUnit = unit_price + calculatePriceAdjustment(modifiers);
  return perUnit * quantity;
}
