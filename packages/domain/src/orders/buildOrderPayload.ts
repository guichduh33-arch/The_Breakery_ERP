// packages/domain/src/orders/buildOrderPayload.ts
import type {
  Cart,
  OrderPayload,
  OrderPayloadItem,
  OrderPayloadPromotion,
  PaymentInput,
} from '../types/index.js';
import type { AppliedPromotion } from '../promotions/types.js';
import { TIERS, tierFromLifetime } from '../loyalty/tiers.js';

function buildItemPayload(item: Cart['items'][number]): OrderPayloadItem {
  const base: OrderPayloadItem = {
    product_id: item.product_id,
    quantity: item.quantity,
    unit_price: item.unit_price,
    modifiers: item.modifiers,
    // Session 9 — pass through gift flags so RPC v7 can tag order_items.
    ...(item.is_promo_gift ? { is_promo_gift: true } : {}),
    ...(item.promotion_id ? { promotion_id: item.promotion_id } : {}),
  };
  if (!item.discount) return base;
  return {
    ...base,
    discount_amount: item.discount.amount,
    discount_type: item.discount.type,
    discount_value: item.discount.value,
    discount_reason: item.discount.reason,
    ...(item.discount.authorized_by ? { discount_authorized_by: item.discount.authorized_by } : {}),
  };
}

function resolveLoyaltyMultiplier(cart: Cart): number {
  if (!cart.customerId) return 1.0;
  return 1.0;
}

/**
 * Map AppliedPromotion[] to the wire-format expected by RPC v7 (`p_promotions`).
 * Spec ref §3.6 — array of `{promotion_id, amount, description, scope_line_id?}`.
 */
function mapPromotions(applied: AppliedPromotion[]): OrderPayloadPromotion[] {
  return applied.map((ap) => ({
    promotion_id: ap.promotion_id,
    amount: ap.amount,
    description: ap.description,
    ...(ap.scope_line_id ? { scope_line_id: ap.scope_line_id } : {}),
  }));
}

export function buildOrderPayload(
  sessionId: string,
  cart: Cart,
  payment: PaymentInput,
  idempotencyKey?: string,
  lifetimePoints?: number,
  cumulLoyaltyMultiplier?: number,
  appliedPromotions?: AppliedPromotion[],
): OrderPayload {
  const multiplier =
    cumulLoyaltyMultiplier ??
    (lifetimePoints != null
      ? (TIERS.find((t) => t.tier === tierFromLifetime(lifetimePoints))?.points_multiplier ?? 1.0)
      : resolveLoyaltyMultiplier(cart));

  const promotions = appliedPromotions && appliedPromotions.length > 0
    ? mapPromotions(appliedPromotions)
    : null;

  return {
    session_id: sessionId,
    order_type: cart.order_type,
    items: cart.items.map(buildItemPayload),
    payment,
    // exactOptionalPropertyTypes-safe: only include the field when defined
    ...(idempotencyKey ? { idempotency_key: idempotencyKey } : {}),
    ...(cart.customerId ? { customer_id: cart.customerId } : {}),
    ...(cart.loyaltyPointsToRedeem ? { loyalty_points_redeemed: cart.loyaltyPointsToRedeem } : {}),
    ...(cart.tableNumber ? { table_number: cart.tableNumber } : {}),
    ...(cart.cartDiscount ? {
      discount_amount: cart.cartDiscount.amount,
      discount_type: cart.cartDiscount.type,
      discount_value: cart.cartDiscount.value,
      discount_reason: cart.cartDiscount.reason,
      ...(cart.cartDiscount.authorized_by ? { discount_authorized_by: cart.cartDiscount.authorized_by } : {}),
    } : {}),
    ...(multiplier !== 1.0 ? { loyalty_multiplier: multiplier } : {}),
    ...(promotions ? { promotions } : {}),
  };
}
