// packages/domain/src/cart/calculateTotals.ts
import { roundIdr } from '@breakery/utils';
import type { Cart, CartTotals } from '../types/index.js';
import { calculatePriceAdjustment } from '../modifiers/calculatePriceAdjustment.js';
import { pointsToValue } from '../loyalty/redeemValue.js';

export class RedemptionExceedsTotalError extends Error {
  constructor() {
    super('Redemption amount exceeds items total');
    this.name = 'RedemptionExceedsTotalError';
  }
}

/**
 * Compute totals for a cart. Modifier price adjustments are stacked on the
 * unit price BEFORE rounding the line total (spec §3.4).
 *
 * Tax is included in the unit price (PB1: extracted from total, not added).
 * When cart.loyaltyPointsToRedeem is set, redemption_amount is subtracted
 * from items_total before tax extraction.
 */
export function calculateTotals(cart: Cart, taxRate: number): CartTotals {
  let items_total = 0;
  let item_count = 0;
  for (const item of cart.items) {
    const adjustment = calculatePriceAdjustment(item.modifiers);
    items_total += roundIdr((item.unit_price + adjustment) * item.quantity);
    item_count += item.quantity;
  }

  const redemption_amount = pointsToValue(cart.loyaltyPointsToRedeem ?? 0);
  if (redemption_amount > items_total) {
    throw new RedemptionExceedsTotalError();
  }

  const total = items_total - redemption_amount;
  const tax_amount = roundIdr((total * taxRate) / (1 + taxRate));
  return { subtotal: items_total, tax_amount, total, item_count, redemption_amount };
}
