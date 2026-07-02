// packages/domain/src/promotions/bogoEngine.ts
//
// Session 13 / Phase 2.C — extended promotion shapes:
//   * BOGO "new shape"  — buy N of any trigger product, get M of a single
//                         reward product free. Distinct from Session 9 BOGO
//                         which used trigger/reward arrays and a percentage
//                         off the reward unit. Both shapes coexist.
//   * threshold         — cart-subtotal or cart-quantity threshold ⇒ percent
//                         or fixed discount.
//   * bundle            — buy N specific products together ⇒ fixed bundle
//                         price (discount = matched_subtotal − bundle_price).
//
// All functions are pure (no Date.now(), no rng, no I/O) so they double as:
//   1. Executable spec for `evaluate_promotions_v2` SQL function.
//   2. Offline fallback when the RPC fails (network outage on the POS).
//
// Used together with the Session 9 `evaluator.ts` / `computeAmount.ts` set —
// `evaluatePromotionsFallback` below wraps both into a single pure entry
// point that the POS hook calls when the RPC is unavailable.

import type { Cart, CartItem } from '../types/index.js';
import { matchAllConditions } from './matchers.js';
import {
  computeBogo,
  computeFixed,
  computeFreeProduct,
  computePercentage,
} from './computeAmount.js';
import type {
  AppliedFreeProduct,
  AppliedPromotion,
  Promotion,
  PromotionCatalog,
  PromotionCustomer,
} from './types.js';

/* ----------------------------- helpers --------------------------------- */

function lineSubtotal(item: CartItem): number {
  return item.unit_price * item.quantity;
}

function nonGiftSubtotal(cart: Cart): number {
  let s = 0;
  for (const it of cart.items) {
    if (it.is_promo_gift) continue;
    s += lineSubtotal(it);
  }
  return s;
}

function nonGiftQuantity(cart: Cart): number {
  let q = 0;
  for (const it of cart.items) {
    if (it.is_promo_gift) continue;
    q += it.quantity;
  }
  return q;
}

function roundHalfUp(n: number): number {
  return Math.round(n);
}

/**
 * True iff the promotion is configured in the *new* BOGO shape
 * (`bogo_buy_quantity`, `bogo_get_quantity`, `bogo_get_product_id` all set).
 * When false, callers should defer to Session 9 `computeBogo` (legacy arrays).
 */
export function isNewBogoShape(promo: Promotion): boolean {
  return (
    promo.type === 'bogo'
    && promo.bogo_buy_quantity != null
    && promo.bogo_get_quantity != null
    && promo.bogo_get_product_id != null
    && promo.bogo_buy_quantity >= 1
    && promo.bogo_get_quantity >= 1
  );
}

/* ----------------------------- BOGO new shape ------------------------- */

/**
 * BOGO new shape — "buy N (of any trigger), get M of a single SKU free".
 *
 * For Phase 2.C the trigger pool is the **entire cart** (any non-gift line
 * counts toward the buy quantity). If the legacy `bogo_trigger_product_ids`
 * array is non-empty, it acts as a filter on which lines count as triggers.
 *
 * Reward = `bogo_get_quantity` × applications units of `bogo_get_product_id`,
 * priced from the catalog (falls back to 0 if absent). The reward is
 * accounted as a `free_items[]` entry on the AppliedPromotion AND as a
 * positive `amount` equal to (units × unit_price) so totals subtract
 * correctly. The cart store then auto-adds a unit_price=0 gift line and
 * the discount manifests as the avoided cost.
 *
 * Applications = floor(triggerQty / buyQty). Caller is responsible for the
 * stacking decision; this returns null if applications=0.
 */
export function evaluateBogoNew(
  promo: Promotion,
  cart: Cart,
  catalog: PromotionCatalog,
): AppliedPromotion | null {
  if (!isNewBogoShape(promo)) return null;
  const buyQty = promo.bogo_buy_quantity!;
  const getQty = promo.bogo_get_quantity!;
  const getProductId = promo.bogo_get_product_id!;

  // Count trigger units. If legacy `bogo_trigger_product_ids` list is
  // present + non-empty, restrict to those products ; else any non-gift line.
  const triggerFilter = promo.bogo_trigger_product_ids;
  const restrictTrigger = triggerFilter.length > 0;
  let triggerCount = 0;
  for (const it of cart.items) {
    if (it.is_promo_gift) continue;
    if (restrictTrigger && !triggerFilter.includes(it.product_id)) continue;
    triggerCount += it.quantity;
  }

  const applications = Math.floor(triggerCount / buyQty);
  if (applications <= 0) return null;

  const totalFreeUnits = applications * getQty;
  const unitPrice = catalog.productPrice[getProductId] ?? 0;
  const amount = roundHalfUp(totalFreeUnits * unitPrice);

  const freeItem: AppliedFreeProduct = {
    product_id: getProductId,
    qty: totalFreeUnits,
  };

  return {
    promotion_id: promo.id,
    slug: promo.slug,
    name: promo.name,
    type: 'bogo',
    amount,
    description: `${promo.name} (buy ${buyQty} get ${getQty} ×${applications})`,
    free_items: [freeItem],
    gift_to_add: freeItem,
  };
}

/* ------------------------------ threshold ----------------------------- */

/**
 * Threshold promotion — when cart subtotal (or unit quantity) reaches
 * `threshold_amount`, apply `discount_value` as either a percent
 * (`max_discount_amount` if set is a cap) or a fixed IDR off. We disambiguate
 * percent vs fixed by inspecting `discount_value`:
 *   - 0 < discount_value ≤ 100 → treated as percent if `scope` is unset
 *     (threshold promos have no scope) OR `max_discount_amount` is set.
 *   - Otherwise treated as fixed IDR.
 *
 * For determinism we add a tiebreaker: callers should set
 * `max_discount_amount` whenever they mean "percent". The DB CHECK enforces
 * `discount_value IS NOT NULL` for type=threshold, so we never get null
 * here in production.
 */
export function evaluateThreshold(
  promo: Promotion,
  cart: Cart,
): AppliedPromotion | null {
  if (promo.type !== 'threshold') return null;
  if (promo.threshold_amount == null || promo.threshold_type == null) return null;
  if (promo.discount_value == null || promo.discount_value <= 0) return null;

  const subtotal = nonGiftSubtotal(cart);
  if (subtotal <= 0) return null;

  let met = false;
  if (promo.threshold_type === 'subtotal') {
    met = subtotal >= promo.threshold_amount;
  } else {
    met = nonGiftQuantity(cart) >= promo.threshold_amount;
  }
  if (!met) return null;

  // Percent vs fixed inference: percent when max_discount_amount is set OR
  // discount_value ≤ 100 AND scope/threshold_type imply rate-based.
  // Production rule: if the cap is set, treat as percent ; else fixed.
  const isPercent = promo.max_discount_amount != null
    || (promo.discount_value > 0 && promo.discount_value <= 100 && promo.threshold_type === 'subtotal' && promo.discount_value === Math.round(promo.discount_value * 100) / 100);
  let amount: number;
  if (isPercent) {
    amount = roundHalfUp((subtotal * promo.discount_value) / 100);
    if (promo.max_discount_amount != null) {
      amount = Math.min(amount, promo.max_discount_amount);
    }
  } else {
    amount = promo.discount_value;
  }
  amount = Math.min(amount, subtotal);
  if (amount <= 0) return null;

  return {
    promotion_id: promo.id,
    slug: promo.slug,
    name: promo.name,
    type: 'threshold',
    amount,
    description: `${promo.name} (threshold ${promo.threshold_type})`,
  };
}

/* -------------------------------- bundle ------------------------------ */

/**
 * Bundle promotion — every product in `bundle_product_ids` must appear in
 * the cart with quantity ≥ 1. Discount = (Σ first-matching-line subtotals)
 * − `bundle_price`. We deliberately only count the *first* matching line
 * per product (qty 1) — adding a 2nd croissant doesn't double the bundle.
 * Callers wanting "2 bundles" should configure two separate promotions or
 * apply the bundle multiple times (future extension).
 */
export function evaluateBundle(
  promo: Promotion,
  cart: Cart,
  catalog: PromotionCatalog,
): AppliedPromotion | null {
  if (promo.type !== 'bundle') return null;
  if (!promo.bundle_product_ids || promo.bundle_product_ids.length < 2) return null;
  if (promo.bundle_price == null || promo.bundle_price < 0) return null;

  // For each bundle product id, pick the cheapest matching non-gift line.
  // If any product is missing → bundle doesn't apply.
  let matchedSubtotal = 0;
  for (const pid of promo.bundle_product_ids) {
    let matchPrice: number | null = null;
    for (const it of cart.items) {
      if (it.is_promo_gift) continue;
      if (it.product_id !== pid || it.quantity < 1) continue;
      const unit = it.unit_price;
      if (matchPrice === null || unit < matchPrice) matchPrice = unit;
    }
    if (matchPrice === null) {
      // Fallback to catalog price if the cart line is missing — but the
      // spec requires the product to be in the cart, so we bail.
      // (catalog reference kept for parity with the SQL function path.)
      void catalog;
      return null;
    }
    matchedSubtotal += matchPrice;
  }
  const discount = matchedSubtotal - promo.bundle_price;
  if (discount <= 0) return null;

  return {
    promotion_id: promo.id,
    slug: promo.slug,
    name: promo.name,
    type: 'bundle',
    amount: roundHalfUp(discount),
    description: `${promo.name} (bundle Rp ${Math.round(promo.bundle_price).toLocaleString('en-US')})`,
  };
}

/* --------------------- full fallback (used on RPC failure) ------------ */

/**
 * Dispatch one promotion to the right computer. Handles every type
 * (percentage / fixed_amount / bogo legacy / bogo new / threshold / bundle /
 * free_product). Returns null when nothing applies.
 *
 * Pure ; safe to call from React render path (the POS hook does).
 */
export function computePromotion(
  promo: Promotion,
  cart: Cart,
  customer: PromotionCustomer | null,
  catalog: PromotionCatalog,
): AppliedPromotion | null {
  switch (promo.type) {
    case 'percentage':
      return computePercentage(promo, cart, catalog);
    case 'fixed_amount':
      return computeFixed(promo, cart);
    case 'bogo':
      // Prefer new shape when fully configured; else legacy.
      if (isNewBogoShape(promo)) return evaluateBogoNew(promo, cart, catalog);
      return computeBogo(promo, cart, catalog);
    case 'free_product':
      return computeFreeProduct(promo, cart, customer);
    case 'threshold':
      return evaluateThreshold(promo, cart);
    case 'bundle':
      return evaluateBundle(promo, cart, catalog);
    /* c8 ignore next 2 — TS exhaustive guard */
    default:
      return null;
  }
}

/**
 * Stage 4 — apply stacking (mirrors evaluator.ts):
 * first eligible wins ; subsequent require both anchor & candidate
 * `stackable_with_promo=true`.
 */
function applyStacking(
  applied: AppliedPromotion[],
  lookup: Map<string, Promotion>,
): AppliedPromotion[] {
  if (applied.length === 0) return [];
  const out: AppliedPromotion[] = [];
  let firstStackable: boolean | null = null;
  for (const ap of applied) {
    const p = lookup.get(ap.promotion_id);
    /* c8 ignore next */
    if (!p) continue;
    if (out.length === 0) {
      out.push(ap);
      firstStackable = p.stackable_with_promo;
      continue;
    }
    if (firstStackable === true && p.stackable_with_promo === true) {
      out.push(ap);
    }
  }
  return out;
}

function sortByPriority(
  a: AppliedPromotion,
  b: AppliedPromotion,
  lookup: Map<string, Promotion>,
): number {
  const pa = lookup.get(a.promotion_id);
  const pb = lookup.get(b.promotion_id);
  /* c8 ignore next */
  if (!pa || !pb) return 0;
  if (pa.priority !== pb.priority) return pb.priority - pa.priority;
  return new Date(pb.created_at).getTime() - new Date(pa.created_at).getTime();
}

export interface EvaluatePromotionsFallbackOptions {
  dismissedPromotionIds?: ReadonlySet<string>;
}

/**
 * Offline fallback entry — full promo evaluation (matchers + per-type
 * compute + stacking) covering Session 9 shapes AND the Phase 2.C new
 * shapes. Used by the POS hook when `evaluate_promotions_v2` RPC fails.
 * (S57 A-D10: this offline fallback has no knowledge of usage caps — the
 * server, via evaluate_promotions_v2, is the reference for max_uses /
 * max_uses_per_customer. Only exercised when the RPC is unreachable.)
 *
 * Pure / deterministic given (promotions, cart, customer, now, catalog).
 */
export function evaluatePromotionsFallback(
  promotions: Promotion[],
  cart: Cart,
  customer: PromotionCustomer | null,
  now: Date,
  catalog: PromotionCatalog,
  options: EvaluatePromotionsFallbackOptions = {},
): AppliedPromotion[] {
  const dismissed = options.dismissedPromotionIds ?? new Set<string>();
  const lookup = new Map<string, Promotion>();
  const computed: AppliedPromotion[] = [];

  for (const p of promotions) {
    if (!p.is_active) continue;
    if (dismissed.has(p.id)) continue;
    if (!matchAllConditions(p, cart, customer, now)) continue;
    const ap = computePromotion(p, cart, customer, catalog);
    if (!ap) continue;
    lookup.set(p.id, p);
    computed.push(ap);
  }
  if (computed.length === 0) return [];

  computed.sort((a, b) => sortByPriority(a, b, lookup));
  return applyStacking(computed, lookup);
}
