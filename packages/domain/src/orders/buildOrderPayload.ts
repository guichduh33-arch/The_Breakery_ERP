// packages/domain/src/orders/buildOrderPayload.ts
import type { Cart, OrderPayload, PaymentInput } from '../types/index.js';

export function buildOrderPayload(
  sessionId: string,
  cart: Cart,
  payment: PaymentInput,
  idempotencyKey?: string,
): OrderPayload {
  return {
    session_id: sessionId,
    order_type: cart.order_type,
    items: cart.items.map((i) => ({
      product_id: i.product_id,
      quantity: i.quantity,
      unit_price: i.unit_price,
      modifiers: i.modifiers,
    })),
    payment,
    // exactOptionalPropertyTypes-safe: only include the field when defined
    ...(idempotencyKey ? { idempotency_key: idempotencyKey } : {}),
    ...(cart.customerId ? { customer_id: cart.customerId } : {}),
    ...(cart.loyaltyPointsToRedeem ? { loyalty_points_redeemed: cart.loyaltyPointsToRedeem } : {}),
  };
}
