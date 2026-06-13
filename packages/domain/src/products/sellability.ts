// packages/domain/src/products/sellability.ts
//
// Session 43 (P1-1) — POS sellability rule.
//
// `track_inventory = false` (made-to-order items, e.g. beverages brewed à la
// minute) are NEVER sold out regardless of any stock counter. For tracked
// products the vitrine counter (`display_stock.quantity`) takes precedence
// when a row exists; otherwise fall back to `products.current_stock`.
// `undefined` track_inventory (legacy rows) behaves as tracked.

export function isSellable(
  track_inventory: boolean | undefined,
  displayQty: number | null,
  current_stock: number,
): boolean {
  if (track_inventory === false) return true;
  const qty = displayQty ?? current_stock;
  return qty > 0;
}
