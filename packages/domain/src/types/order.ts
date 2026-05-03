// packages/domain/src/types/order.ts
import type { OrderType } from './cart.js';
import type { PaymentInput } from './payment.js';

export type OrderStatus = 'draft' | 'paid' | 'voided';

export interface OrderPayload {
  session_id: string;
  order_type: OrderType;
  items: Array<{ product_id: string; quantity: number; unit_price: number }>;
  payment: PaymentInput;
}
