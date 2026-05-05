import type { CartItem } from '../types/cart.js';

export type { CartItem };

export interface TabletCart {
  items: CartItem[];
  tableNumber: string | null;
  orderType: 'dine_in' | 'take_out';
}

export interface TabletOrderEntry {
  id: string;
  order_number: string;
  table_number: string | null;
  order_type: 'dine_in' | 'take_out';
  waiter_id: string;
  waiter_name: string;
  sent_to_kitchen_at: string;
  items_count: number;
  items_total: number;
}
