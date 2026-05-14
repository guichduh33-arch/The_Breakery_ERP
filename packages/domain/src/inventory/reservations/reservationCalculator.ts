// packages/domain/src/inventory/reservations/reservationCalculator.ts
// Session 13 / Phase 3.C — Pure-TS helpers for stock reservation accounting.
//
// Mirrors the SQL view v_product_available_stock so client code can compute
// availability without round-tripping the DB. IO-free.

export interface ActiveReservation {
  /** Quantity virtually held against current_stock. */
  readonly quantity: number;
  /** ISO 8601 timestamp; rows past this are no longer counted. */
  readonly expiresAt: string;
  /** Lifecycle status. Only 'held' rows contribute to held_quantity. */
  readonly status: 'held' | 'released' | 'consumed';
}

/**
 * Sum the quantities of reservations that are still actively held.
 *
 * An entry is "active" iff status === 'held' AND expiresAt is in the future
 * relative to `now`.
 *
 * Negative quantities are ignored (defensive — RPC enforces > 0 already).
 */
export function activeHeldQuantity(
  reservations: ReadonlyArray<ActiveReservation>,
  now: Date = new Date(),
): number {
  if (!reservations || reservations.length === 0) return 0;
  const nowMs = now.getTime();
  let total = 0;
  for (const r of reservations) {
    if (r.status !== 'held') continue;
    const exp = Date.parse(r.expiresAt);
    if (Number.isNaN(exp) || exp <= nowMs) continue;
    if (r.quantity > 0) total += r.quantity;
  }
  return total;
}

/**
 * Compute available stock = max(0, currentStock − active holds).
 *
 * Clamps to zero so callers cannot accidentally surface negative
 * availability (which would imply an over-hold race already resolved by the
 * server-side FOR UPDATE lock in `reservation_hold_v1`).
 */
export function availableQuantity(
  currentStock: number,
  reservations: ReadonlyArray<ActiveReservation>,
  now: Date = new Date(),
): number {
  const held = activeHeldQuantity(reservations, now);
  const avail = currentStock - held;
  return avail > 0 ? avail : 0;
}

/**
 * Whether placing a hold of `requested` against `currentStock` would succeed.
 *
 * Useful in optimistic UI ("Add to cart" disabled when out of stock) and as
 * a pre-flight check before invoking `reservation_hold_v1`. The RPC remains
 * the source of truth (FOR UPDATE row lock + race-safe).
 */
export function canHoldQuantity(
  requested: number,
  currentStock: number,
  reservations: ReadonlyArray<ActiveReservation>,
  now: Date = new Date(),
): boolean {
  if (requested <= 0) return false;
  return availableQuantity(currentStock, reservations, now) >= requested;
}
