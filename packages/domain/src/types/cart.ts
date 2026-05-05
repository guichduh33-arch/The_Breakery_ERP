// packages/domain/src/types/cart.ts
import type { SelectedModifiers } from '../modifiers/types.js';

export type OrderType = 'dine_in' | 'take_out' | 'delivery';

export interface CartItem {
  /**
   * Stable line id, generated client-side. A single product may appear on
   * multiple lines if rung up with different modifier sets — therefore
   * `product_id` is NOT a unique key, but `id` is.
   */
  id: string;
  product_id: string;
  name: string;
  unit_price: number;
  quantity: number;
  /** Selected options snapshot — empty array if the product has no modifiers. */
  modifiers: SelectedModifiers;
}

export interface Cart {
  items: CartItem[];
  order_type: OrderType;
  customerId?: string;
  loyaltyPointsToRedeem?: number;
  tableNumber?: string | null;
}

export interface CartTotals {
  subtotal: number;
  tax_amount: number;
  total: number;
  item_count: number;
  redemption_amount: number;
}
