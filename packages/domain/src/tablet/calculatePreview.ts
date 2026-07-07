import { roundIdr } from '@breakery/utils';
import { calculatePriceAdjustment } from '../modifiers/calculatePriceAdjustment.js';
import { DEFAULT_TAX_RATE } from '../orders/taxRate.js';
import type { TabletCart } from './types.js';

export interface TabletPreview {
  items_total: number;
  tax_amount: number;
}

/**
 * Estimate the tablet cart total and the PB1-included tax embedded in it.
 *
 * `taxRate` is the live server rate (`business_config.tax_rate`, read via the
 * POS `useTaxRate()` hook) expressed as a fraction (e.g. `0.10`). It defaults
 * to `DEFAULT_TAX_RATE` so callers that have not wired the live rate still get
 * a usable estimate. The server RPC remains the sole pricing authority — this
 * is display-only.
 */
export function calculatePreview(cart: TabletCart, taxRate: number = DEFAULT_TAX_RATE): TabletPreview {
  let items_total = 0;
  for (const item of cart.items) {
    const adjustment = calculatePriceAdjustment(item.modifiers);
    items_total += roundIdr((item.unit_price + adjustment) * item.quantity);
  }
  const tax_amount = Math.round((items_total * taxRate) / (1 + taxRate));
  return { items_total, tax_amount };
}
