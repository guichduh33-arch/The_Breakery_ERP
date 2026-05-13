// packages/domain/src/inventory/expiry/fifo.ts
// Session 13 — F1 expiry tracking : pure-TS FIFO lot selection.
//
// MIRRORS the DB-side `_resolve_fifo_lot(product_id, quantity_needed)` helper
// invoked by `record_stock_movement_v1` (migration 20260517000020 / 000043).
// Kept as a pure module so:
//   1. POS/BO can prefetch the lot id client-side for UX (show "consuming lot
//      #ABC123 expiring 2026-05-15 18:00") before the RPC roundtrip ;
//   2. unit tests can validate the FIFO algorithm in isolation, without a DB ;
//   3. the BO Expiring page can run the same selection logic for "preview"
//      drawers without burning a SECURITY DEFINER call.
//
// The DB is the source of truth. Any divergence between this helper and the
// SQL `_resolve_fifo_lot` is a bug in this file — never the other way around.
// See pgTAP `T_F1_NO_TRIGGER_INVARIANT` for the corresponding invariant test.

/**
 * Lot row shape used by the pure FIFO selector. Mirrors the public columns
 * of `stock_lots` that callers (`useStockLots`, `useExpiringLots`) surface.
 *
 * `quantity` is the REMAINING quantity on the lot (already-consumed amount
 * is reflected as a decrement on this column by `record_stock_movement_v1`).
 * Only lots with `status === 'active'` AND `quantity > 0` are eligible.
 */
export interface StockLotForFifo {
  id: string;
  product_id: string;
  /** Remaining quantity on the lot. Must be > 0 to be selectable. */
  quantity: number;
  /** ISO-8601 expiry timestamp. Earlier expiry wins (FIFO by expiry). */
  expires_at: string;
  status: 'active' | 'expired' | 'consumed';
  /** ISO-8601 received timestamp — tie-breaker when expires_at is equal. */
  received_at?: string | null;
}

/**
 * Result of attempting to select a lot for consumption.
 *
 * - `ok: true` → caller may pass `lot.id` to `record_stock_movement_v1` as
 *   `p_lot_id` (or omit it and let the DB self-resolve identically).
 * - `ok: false` reasons:
 *   - `no_active_lots`  : no eligible lot found at all (product never tracked
 *     under F1, or all lots expired/consumed).
 *   - `insufficient_qty`: the single FIFO lot exists but its remaining qty is
 *     strictly less than `quantity_needed`. F1 MVP does NOT split a single
 *     consumption across multiple lots (deferred — see spec D15). Caller can
 *     either fall back to a non-lot-tracked path or split client-side.
 */
export type FifoSelectionResult =
  | { ok: true; lot: StockLotForFifo }
  | { ok: false; reason: 'no_active_lots' | 'insufficient_qty' };

/**
 * Select a single stock lot for a consuming movement (sale, waste,
 * transfer_out, production_out, sale_void-reverse, etc.) using FIFO by
 * `expires_at` ASC (earliest expiry first).
 *
 * Algorithm (mirrors `_resolve_fifo_lot`):
 *   1. Filter to lots matching `product_id`, `status === 'active'`,
 *      `quantity > 0`.
 *   2. Sort by `expires_at` ASC, then by `received_at` ASC as tie-breaker
 *      (older receipts first when two lots expire simultaneously), then by
 *      `id` ASC for total determinism (DB uses the same tie-breakers).
 *   3. Return the head of the sorted list IF its `quantity >= quantity_needed`.
 *      Otherwise return `insufficient_qty` (no auto-split in MVP).
 *
 * The function is total and side-effect-free.
 */
export function selectLotForConsumption(
  lots: readonly StockLotForFifo[],
  productId: string,
  quantityNeeded: number,
): FifoSelectionResult {
  if (quantityNeeded <= 0) {
    // Defensive — callers should validate first, but a non-positive consume
    // is structurally a no-op for lot selection.
    return { ok: false, reason: 'no_active_lots' };
  }

  const eligible = lots
    .filter(
      (l) =>
        l.product_id === productId &&
        l.status === 'active' &&
        l.quantity > 0,
    )
    .slice()
    .sort((a, b) => {
      // Primary: expires_at ASC.
      const ea = Date.parse(a.expires_at);
      const eb = Date.parse(b.expires_at);
      if (ea !== eb) return ea - eb;
      // Secondary: received_at ASC (NULL treated as +Infinity so explicit dates win).
      const ra =
        a.received_at != null && a.received_at !== ''
          ? Date.parse(a.received_at)
          : Number.POSITIVE_INFINITY;
      const rb =
        b.received_at != null && b.received_at !== ''
          ? Date.parse(b.received_at)
          : Number.POSITIVE_INFINITY;
      if (ra !== rb) return ra - rb;
      // Tertiary: id ASC for deterministic ordering across runs.
      return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
    });

  if (eligible.length === 0) {
    return { ok: false, reason: 'no_active_lots' };
  }

  const head = eligible[0]!;
  if (head.quantity < quantityNeeded) {
    return { ok: false, reason: 'insufficient_qty' };
  }
  return { ok: true, lot: head };
}

/**
 * Convenience predicate : are ALL active lots for a product expired (i.e.
 * `status === 'expired'`) or fully consumed (`quantity === 0`)?
 *
 * Used by the POS ProductCard to grey-out a product when expiry tracking is
 * enabled but every existing lot is dead. A product with NO lots at all is
 * treated as "not tracked under F1" → returns `false` (don't disable).
 */
export function allLotsExpiredOrConsumed(
  lots: readonly StockLotForFifo[],
  productId: string,
): boolean {
  const productLots = lots.filter((l) => l.product_id === productId);
  if (productLots.length === 0) return false; // not under F1 — don't disable
  return productLots.every((l) => l.status !== 'active' || l.quantity <= 0);
}

/**
 * Returns lots expiring within the next `hoursAhead` hours from `now`.
 * Used by the BO Expiring page badge + listing. Pure derivation — the DB
 * also exposes `get_expiring_lots_v1(p_hours_ahead INT)` for the same query
 * with RLS, but this helper is convenient for in-memory filtering after a
 * single bulk fetch.
 *
 * - `now` is injectable for deterministic tests.
 * - Only `status === 'active'` lots are considered.
 * - Lots already expired (`expires_at < now`) are INCLUDED (their UI surface
 *   should display them as "expired" until the hourly cron flips status).
 */
export function filterExpiringLots(
  lots: readonly StockLotForFifo[],
  hoursAhead: number,
  now: Date = new Date(),
): StockLotForFifo[] {
  const threshold = now.getTime() + hoursAhead * 60 * 60 * 1000;
  return lots
    .filter((l) => l.status === 'active' && Date.parse(l.expires_at) <= threshold)
    .slice()
    .sort((a, b) => Date.parse(a.expires_at) - Date.parse(b.expires_at));
}
