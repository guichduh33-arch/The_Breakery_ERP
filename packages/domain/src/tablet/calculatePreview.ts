import { roundIdr } from '@breakery/utils';
import { calculatePriceAdjustment } from '../modifiers/calculatePriceAdjustment.js';
import type { TabletCart } from './types.js';

const TAX_RATE = 10 / 100;

export interface TabletPreview {
  items_total: number;
  tax_amount: number;
}

export function calculatePreview(cart: TabletCart): TabletPreview {
  let items_total = 0;
  for (const item of cart.items) {
    const adjustment = calculatePriceAdjustment(item.modifiers);
    items_total += roundIdr((item.unit_price + adjustment) * item.quantity);
  }
  const tax_amount = Math.round(items_total * TAX_RATE / (1 + TAX_RATE));
  return { items_total, tax_amount };
}
