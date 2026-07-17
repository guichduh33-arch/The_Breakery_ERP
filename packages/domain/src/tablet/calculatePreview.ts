import { roundIdr } from '@breakery/utils';
import { calculatePriceAdjustment } from '../modifiers/calculatePriceAdjustment.js';
import { DEFAULT_TAX_RATE } from '../orders/taxRate.js';
import type { TabletCart } from './types.js';

export interface TabletPreview {
  items_total: number;
  tax_amount: number;
  /** Amount the customer pays: items_total (inclusive) or items_total + tax (exclusive). */
  total: number;
}

/**
 * Estimate the tablet cart total and its PB1 share.
 *
 * `taxRate` is the live server rate (`business_config.tax_rate`, read via the
 * POS `useTaxRate()` hook) expressed as a fraction (e.g. `0.10`). It defaults
 * to `DEFAULT_TAX_RATE` so callers that have not wired the live rate still get
 * a usable estimate. `taxInclusive` mirrors `_pb1_split_v1` (Lot 6b) —
 * inclusive extracts the PB1 from the total, exclusive adds it on top.
 * The server RPC remains the sole pricing authority — this is display-only.
 */
export function calculatePreview(
  cart: TabletCart,
  taxRate: number = DEFAULT_TAX_RATE,
  taxInclusive = true,
): TabletPreview {
  let items_total = 0;
  for (const item of cart.items) {
    const adjustment = calculatePriceAdjustment(item.modifiers);
    items_total += roundIdr((item.unit_price + adjustment) * item.quantity);
  }
  if (taxInclusive) {
    const tax_amount = Math.round((items_total * taxRate) / (1 + taxRate));
    return { items_total, tax_amount, total: items_total };
  }
  const tax_amount = roundIdr(items_total * taxRate);
  return { items_total, tax_amount, total: items_total + tax_amount };
}
