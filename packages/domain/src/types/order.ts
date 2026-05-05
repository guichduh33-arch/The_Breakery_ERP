// packages/domain/src/types/order.ts
import type { OrderType } from './cart.js';
import type { ModifierOption } from '../modifiers/types.js';
import type { PaymentInput } from './payment.js';

export type OrderStatus = 'draft' | 'paid' | 'voided';

export interface OrderPayloadItem {
  product_id: string;
  quantity: number;
  unit_price: number;
  /**
   * Snapshot of selected modifier options. Empty array when product has no
   * modifiers. Persisted by `complete_order_with_payment` into
   * `order_items.modifiers` (JSONB).
   */
  modifiers: ModifierOption[];
}

export interface OrderPayload {
  session_id: string;
  order_type: OrderType;
  items: OrderPayloadItem[];
  payment: PaymentInput;
  /**
   * Optional idempotency key (UUID v4). When the same key is replayed against
   * `process-payment`, the server returns the existing order instead of creating
   * a duplicate (decision D8 of the session-1 addendum).
   */
  idempotency_key?: string;
  customer_id?: string;
  loyalty_points_redeemed?: number;
}
