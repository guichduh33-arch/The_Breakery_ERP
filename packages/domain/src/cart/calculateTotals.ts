// packages/domain/src/cart/calculateTotals.ts
import { roundIdr } from '@breakery/utils';
import type { Cart, CartTotals } from '../types/index.js';
import { calculatePriceAdjustment } from '../modifiers/calculatePriceAdjustment.js';

/**
 * Compute totals for a cart. Modifier price adjustments are stacked on the
 * unit price BEFORE rounding the line total (spec §3.4).
 *
 * Tax is included in the unit price (PB1: extracted from total, not added).
 */
export function calculateTotals(cart: Cart, taxRate: number): CartTotals {
  let subtotal = 0;
  let item_count = 0;
  for (const item of cart.items) {
    const adjustment = calculatePriceAdjustment(item.modifiers);
    subtotal += roundIdr((item.unit_price + adjustment) * item.quantity);
    item_count += item.quantity;
  }
  const tax_amount = roundIdr((subtotal * taxRate) / (1 + taxRate));
  return { subtotal, tax_amount, total: subtotal, item_count };
}
