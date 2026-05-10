// packages/domain/src/cart/calculateTotals.ts
import { roundIdr } from '@breakery/utils';
import type { Cart, CartTotals } from '../types/index.js';
import { calculatePriceAdjustment } from '../modifiers/calculatePriceAdjustment.js';
import { pointsToValue } from '../loyalty/redeemValue.js';
import { calculateDiscountAmount } from '../discounts/calculateDiscountAmount.js';

export class RedemptionExceedsTotalError extends Error {
  constructor() {
    super('Redemption amount exceeds items total');
    this.name = 'RedemptionExceedsTotalError';
  }
}

export class DiscountExceedsTotalError extends Error {
  constructor() {
    super('Discounts exceed items total');
    this.name = 'DiscountExceedsTotalError';
  }
}

/**
 * Compute totals for a cart. Modifier price adjustments are stacked on the
 * unit price BEFORE rounding the line total (spec §3.4).
 *
 * Tax is included in the unit price (PB1: extracted from total, not added).
 *
 * Order of operations (spec D6, D7, session-8):
 *   items_total   = Σ(line_unit_total * qty - line_discount_amount)
 *   post_promo    = items_total - promotionTotal   (throw DiscountExceedsTotalError if < 0)
 *   post_redemp   = post_promo - redemption_amount (throw RedemptionExceedsTotalError if < 0)
 *   total         = post_redemp - cart_discount    (throw DiscountExceedsTotalError if < 0)
 *   tax_amount    = round(total * taxRate / (1 + taxRate))
 */
export function calculateTotals(cart: Cart, taxRate: number): CartTotals {
  let items_total = 0;
  let item_count = 0;

  for (const item of cart.items) {
    const adjustment = calculatePriceAdjustment(item.modifiers);
    const line_pre_discount = roundIdr((item.unit_price + adjustment) * item.quantity);
    const line_discount = item.discount
      ? calculateDiscountAmount(item.discount, line_pre_discount)
      : 0;
    items_total += line_pre_discount - line_discount;
    item_count += item.quantity;
  }

  const promotion_total = cart.promotionTotal ?? 0;
  const post_promotion = items_total - promotion_total;
  if (post_promotion < 0) {
    throw new DiscountExceedsTotalError();
  }

  const redemption_amount = pointsToValue(cart.loyaltyPointsToRedeem ?? 0);
  if (redemption_amount > post_promotion) {
    throw new RedemptionExceedsTotalError();
  }

  const post_redemption = post_promotion - redemption_amount;
  const cart_discount = cart.cartDiscount
    ? calculateDiscountAmount(cart.cartDiscount, post_redemption)
    : 0;

  const total = post_redemption - cart_discount;
  if (total < 0) {
    throw new DiscountExceedsTotalError();
  }

  const tax_amount = roundIdr((total * taxRate) / (1 + taxRate));
  return { subtotal: items_total, tax_amount, total, item_count, redemption_amount };
}
