// packages/domain/src/cart/calculateTotals.ts
import { roundIdr } from '@breakery/utils';
import type { Cart, CartTotals } from '../types/index.js';

export function calculateTotals(cart: Cart, taxRate: number): CartTotals {
  let subtotal = 0;
  let item_count = 0;
  for (const item of cart.items) {
    subtotal += roundIdr(item.unit_price * item.quantity);
    item_count += item.quantity;
  }
  const tax_amount = roundIdr((subtotal * taxRate) / (1 + taxRate));
  return { subtotal, tax_amount, total: subtotal, item_count };
}
