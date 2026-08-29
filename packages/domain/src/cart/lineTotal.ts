// packages/domain/src/cart/lineTotal.ts
//
// Single source of truth for what one cart line costs. Extracted 2026-08-29
// (critique P1) : OrderSummaryPanel recomputed a line total that ignored
// combo component-modifier adjustments (ADR-017) — the exact bug already fixed
// in ComboCartLineRow on 2026-07-31. Every renderer of a line total and
// calculateTotals now share this formula, so they cannot drift apart again.

import { roundIdr } from '@breakery/utils';
import type { CartItem } from '../types/index.js';
import { calculatePriceAdjustment } from '../modifiers/calculatePriceAdjustment.js';

/**
 * Per-unit price of a cart line: base price + option surcharges (line
 * modifiers) + combo component-modifier adjustments (ADR-017 — summed per
 * component ELEMENT, never multiplied by the component's own quantity; the
 * server's price resolver does the same).
 */
export function lineUnitEach(item: CartItem): number {
  const componentAdjustment = (item.combo_components ?? []).reduce(
    (sum, c) => sum + calculatePriceAdjustment(c.modifiers ?? []),
    0,
  );
  return item.unit_price + calculatePriceAdjustment(item.modifiers) + componentAdjustment;
}

/**
 * Pre-discount line total, rounded the way calculateTotals bills it
 * (adjustments stacked on the unit price BEFORE rounding — spec §3.4).
 */
export function lineTotalOf(item: CartItem): number {
  return roundIdr(lineUnitEach(item) * item.quantity);
}
