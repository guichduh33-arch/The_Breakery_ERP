// packages/domain/src/types/cart.ts
export type OrderType = 'dine_in' | 'take_out' | 'delivery';

export interface CartItem {
  product_id: string;
  name: string;
  unit_price: number;
  quantity: number;
}

export interface Cart {
  items: CartItem[];
  order_type: OrderType;
}

export interface CartTotals {
  subtotal: number;
  tax_amount: number;
  total: number;
  item_count: number;
}
