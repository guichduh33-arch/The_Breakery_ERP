// packages/domain/src/cart/calculateTotals.ts
import { roundIdr } from '@breakery/utils';
import type { Cart, CartTotals } from '../types/index.js';
import { calculatePriceAdjustment } from '../modifiers/calculatePriceAdjustment.js';
import { pointsToValue } from '../loyalty/redeemValue.js';
import { calculateDiscountAmount } from '../discounts/calculateDiscountAmount.js';
import { splitPb1 } from '../orders/taxRate.js';

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
 * Tax mirrors `_pb1_split_v1`, the sole server-side carrier of the PB1
 * formula (Lot 6a/6b — the global `business_config.tax_inclusive` setting):
 *   inclusive (default) — PB1 extracted from the charged total, total unchanged
 *   exclusive           — PB1 added on top: tax = round(total * r), grand
 *                         total = total + tax
 *
 * Order of operations (spec D6, D7, session-8):
 *   items_total   = Σ(line_unit_total * qty - line_discount_amount)
 *   post_promo    = items_total - promotionTotal   (throw DiscountExceedsTotalError if < 0)
 *   post_redemp   = post_promo - redemption_amount (throw RedemptionExceedsTotalError if < 0)
 *   total         = post_redemp - cart_discount    (throw DiscountExceedsTotalError if < 0)
 *   inclusive : tax_amount = round(total * taxRate / (1 + taxRate))
 *   exclusive : tax_amount = round(total * taxRate) ; total += tax_amount
 */
export function calculateTotals(cart: Cart, taxRate: number, taxInclusive = true): CartTotals {
  let items_total = 0;
  let item_count = 0;

  for (const item of cart.items) {
    // Session 10: cancelled items are excluded from totals.
    if (item.is_cancelled) continue;
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

  const split = splitPb1(total, taxRate, taxInclusive);
  return { subtotal: items_total, tax_amount: split.tax_amount, total: split.total, item_count, redemption_amount };
}
