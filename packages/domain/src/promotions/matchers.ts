// packages/domain/src/promotions/matchers.ts
//
// Pure condition matchers for the promotions evaluator (session 9).
// Each function is deterministic given inputs — no Date.now(), no Math.random.
// Spec ref: 2026-05-10-session-9-promotions-spec.md §1 P3, §4.1

import type { Cart } from '../types/index.js';
import type { Promotion, PromotionCustomer } from './types.js';

/**
 * True if `now` falls inside the promotion's [start_at, end_at] window.
 * Either bound NULL = unbounded on that side.
 */
export function matchDateRange(promo: Promotion, now: Date): boolean {
  if (promo.start_at) {
    const start = new Date(promo.start_at);
    if (Number.isNaN(start.getTime())) return false;
    if (now.getTime() < start.getTime()) return false;
  }
  if (promo.end_at) {
    const end = new Date(promo.end_at);
    if (Number.isNaN(end.getTime())) return false;
    if (now.getTime() > end.getTime()) return false;
  }
  return true;
}

/**
 * True if `now`'s day-of-week bit is set in `day_of_week_mask`.
 * Spec mapping: bit 0 = Monday, bit 1 = Tuesday, ..., bit 6 = Sunday.
 * `Date.getDay()` returns 0=Sun..6=Sat → we remap to 0=Mon..6=Sun via
 * `(getDay() + 6) % 7`. Mask 127 (0b1111111) means "every day".
 */
export function matchDayOfWeek(promo: Promotion, now: Date): boolean {
  if (!Number.isFinite(promo.day_of_week_mask)) return false;
  if (promo.day_of_week_mask <= 0) return false;
  const bitIdx = (now.getDay() + 6) % 7; // 0=Mon..6=Sun
  return (promo.day_of_week_mask & (1 << bitIdx)) !== 0;
}

/**
 * True if `now`'s hour falls in `[start_hour, end_hour)`.
 * Both NULL → no hour filter (matches all). Half-open interval matches the
 * RPC v7 server-side check: `EXTRACT(HOUR) >= start_hour AND < end_hour`.
 */
export function matchHour(promo: Promotion, now: Date): boolean {
  if (promo.start_hour == null && promo.end_hour == null) return true;
  if (promo.start_hour == null || promo.end_hour == null) return false;
  const h = now.getHours();
  return h >= promo.start_hour && h < promo.end_hour;
}

/**
 * True if the cart's pre-promo items_total clears `min_items_total`.
 * Sums (unit_price * qty) over non-gift lines — gifts (`is_promo_gift=true`)
 * are excluded so a stale gift can't accidentally satisfy the threshold for
 * its own promotion (anti-bootstrap).
 */
export function matchMinTotal(promo: Promotion, cart: Cart): boolean {
  if (!Number.isFinite(promo.min_items_total) || promo.min_items_total <= 0) return true;
  let total = 0;
  for (const it of cart.items) {
    if (it.is_promo_gift) continue;
    total += it.unit_price * it.quantity;
  }
  return total >= promo.min_items_total;
}

/**
 * True if either:
 *   - the promo has no customer_category restriction (empty list = all), OR
 *   - a customer is attached AND its category_id is in the list.
 * No-customer + restricted promo → false (the spec server-side check
 * RAISEs `Promotion requires customer` for the same case).
 */
export function matchCustomerCategory(
  promo: Promotion,
  customer: PromotionCustomer | null,
): boolean {
  if (promo.customer_category_ids.length === 0) return true;
  if (!customer?.category_id) return false;
  return promo.customer_category_ids.includes(customer.category_id);
}

/**
 * Same semantics as `matchCustomerCategory` but for tier_id.
 */
export function matchCustomerTier(
  promo: Promotion,
  customer: PromotionCustomer | null,
): boolean {
  if (promo.customer_tier_ids.length === 0) return true;
  if (!customer?.tier_id) return false;
  return promo.customer_tier_ids.includes(customer.tier_id);
}

/**
 * Convenience: run every matcher in a single boolean fold.
 */
export function matchAllConditions(
  promo: Promotion,
  cart: Cart,
  customer: PromotionCustomer | null,
  now: Date,
): boolean {
  return (
    matchDateRange(promo, now) &&
    matchDayOfWeek(promo, now) &&
    matchHour(promo, now) &&
    matchMinTotal(promo, cart) &&
    matchCustomerCategory(promo, customer) &&
    matchCustomerTier(promo, customer)
  );
}
