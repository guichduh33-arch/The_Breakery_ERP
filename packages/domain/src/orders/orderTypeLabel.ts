// packages/domain/src/orders/orderTypeLabel.ts
//
// Canonical human labels for the DB `order_type` enum. Centralised here so UI
// never compares against ghost values (F-002: 'take_away'/'takeaway' never
// reach the code — the real enum is dine_in|take_out|delivery|b2b) and so the
// vocabulary has a single source of truth.
//
// NOTE: the domain `OrderType` (packages/domain/src/types/cart.ts) is only
// 3-member (dine_in|take_out|delivery) because a POS *cart* can't be b2b — see
// DEV-S36-B-01. Orders, however, CAN be b2b, so the labels are keyed on an
// explicit 4-member union that mirrors the DB enum, without loosening the
// narrower Cart type.

/** Every value of the DB `order_type` enum. */
export type OrderTypeLabelKey = 'dine_in' | 'take_out' | 'delivery' | 'b2b';

/** Display labels for each order_type DB enum member. */
export const ORDER_TYPE_LABELS: Record<OrderTypeLabelKey, string> = {
  dine_in: 'Dine-in',
  take_out: 'Takeaway',
  delivery: 'Delivery',
  b2b: 'B2B',
};

/** Resolve any order_type string to a label; unknown values pass through unchanged. */
export function orderTypeLabel(t: string): string {
  return (ORDER_TYPE_LABELS as Record<string, string>)[t] ?? t;
}
