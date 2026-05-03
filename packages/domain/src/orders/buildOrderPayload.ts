// packages/domain/src/orders/buildOrderPayload.ts
import type { Cart, OrderPayload, PaymentInput } from '../types/index.js';

export function buildOrderPayload(
  sessionId: string,
  cart: Cart,
  payment: PaymentInput,
): OrderPayload {
  return {
    session_id: sessionId,
    order_type: cart.order_type,
    items: cart.items.map((i) => ({
      product_id: i.product_id,
      quantity: i.quantity,
      unit_price: i.unit_price,
    })),
    payment,
  };
}
