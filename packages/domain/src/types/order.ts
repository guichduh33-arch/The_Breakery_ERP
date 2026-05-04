// packages/domain/src/types/order.ts
import type { OrderType } from './cart.js';
import type { PaymentInput } from './payment.js';

export type OrderStatus = 'draft' | 'paid' | 'voided';

export interface OrderPayload {
  session_id: string;
  order_type: OrderType;
  items: { product_id: string; quantity: number; unit_price: number }[];
  payment: PaymentInput;
  /**
   * Optional idempotency key (UUID v4). When the same key is replayed against
   * `process-payment`, the server returns the existing order instead of creating
   * a duplicate (decision D8 of the session-1 addendum).
   */
  idempotency_key?: string;
}
