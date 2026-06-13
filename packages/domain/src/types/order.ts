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
  discount_amount?: number;
  discount_type?: 'percentage' | 'fixed_amount';
  discount_value?: number;
  discount_reason?: string;
  discount_authorized_by?: string;
  /** Session 9 — true when the line was auto-added by the promotions engine. */
  is_promo_gift?: boolean;
  /** Session 9 — id of the promotion that produced this gift line. */
  promotion_id?: string;
}

/** Session 9 — promotion entry in the OrderPayload promotions array. */
export interface OrderPayloadPromotion {
  promotion_id: string;
  amount: number;
  description: string;
  scope_line_id?: string;
}

export interface OrderPayload {
  session_id: string;
  order_type: OrderType;
  items: OrderPayloadItem[];
  /**
   * Single-tender (legacy v7 path). Mutually exclusive with `payments`.
   * Exactly one of `payment` / `payments` MUST be supplied.
   */
  payment?: PaymentInput;
  /**
   * Session 10 — multi-tender array (RPC v8). Length 1..5. Sum(amounts) MUST equal final total.
   * Only the LAST entry may have cash_received > amount (intermediate cash overpay rejected).
   */
  payments?: PaymentInput[];
  /**
   * Optional idempotency key (UUID v4). When the same key is replayed against
   * `process-payment`, the server returns the existing order instead of creating
   * a duplicate (decision D8 of the session-1 addendum).
   */
  idempotency_key?: string;
  customer_id?: string;
  loyalty_points_redeemed?: number;
  table_number?: string;
  discount_amount?: number;
  discount_type?: 'percentage' | 'fixed_amount';
  discount_value?: number;
  discount_reason?: string;
  discount_authorized_by?: string;
  /**
   * Session 9 — applied promotions to forward to RPC v7 / v4 as
   * `p_promotions`. Server re-validates eligibility and inserts
   * `promotion_applications` rows.
   */
  promotions?: OrderPayloadPromotion[];
}
