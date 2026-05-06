// packages/domain/src/discounts/calculateDiscountAmount.ts
// Spec §4.1 (critical note 2): percentage → Math.round, fixed_amount → Math.min(value, base)

import type { Discount } from './types.js';

type DiscountInput = Pick<Discount, 'type' | 'value'>;

/**
 * Compute the absolute IDR discount amount from a discount definition + base.
 * - percentage: Math.round(base * value / 100), capped at base
 * - fixed_amount: Math.min(value, base) — never negative
 * - Negative or NaN inputs → 0 (defensive)
 */
export function calculateDiscountAmount(input: DiscountInput, base: number): number {
  if (!Number.isFinite(base) || base <= 0) return 0;
  if (!Number.isFinite(input.value) || input.value <= 0) return 0;

  if (input.type === 'percentage') {
    const raw = Math.round(base * input.value / 100);
    return Math.min(raw, base);
  }

  // fixed_amount
  return Math.min(input.value, base);
}
