// packages/domain/src/promotions/computeAmount.ts
//
// Per-type amount computers for the promotions evaluator (session 9).
// All functions are pure — no Date.now(), no rng, no I/O.
// Spec ref: 2026-05-10-session-9-promotions-spec.md §1 P7, §4.1, §7

import type { Cart, CartItem } from '../types/index.js';
import type {
  AppliedPromotion,
  Promotion,
  PromotionCatalog,
  PromotionCustomer,
} from './types.js';

/* ----------------------------- helpers --------------------------------- */

function lineSubtotal(item: CartItem): number {
  // Promotions compute on the post-category unit price (cf. spec P10).
  // We deliberately ignore modifier price adjustments here — those are
  // accounted for in calculateTotals' `items_total` already; the promotions
  // engine targets the base unit price as captured at addItem time, which
  // matches the server-side reference (RPC re-eval reads the same fields).
  return item.unit_price * item.quantity;
}

function applyMaxCap(amount: number, max: number | null | undefined): number {
  if (max == null || !Number.isFinite(max)) return amount;
  return Math.min(amount, max);
}

function roundHalfUp(n: number): number {
  // IDR is rupiah-rounded already; promotions monétaires are still expressed
  // in rupees but stored as DECIMAL(14,2). Round to nearest integer rupee to
  // mirror calculateDiscountAmount and avoid float drift in the UI.
  return Math.round(n);
}

function isCartItemEligibleForPercent(
  promo: Promotion,
  item: CartItem,
  catalog: PromotionCatalog,
): boolean {
  if (item.is_promo_gift) return false;
  if (promo.scope === 'cart') return true;
  if (promo.scope === 'product') {
    return promo.scope_product_ids.includes(item.product_id);
  }
  if (promo.scope === 'category') {
    const catId = catalog.productCategory[item.product_id];
    return catId !== undefined && promo.scope_category_ids.includes(catId);
  }
  return false;
}

function describePromo(promo: Promotion, amount: number): string {
  if (promo.type === 'percentage' && promo.discount_value != null) {
    return `${promo.name} −${promo.discount_value}%`;
  }
  if (promo.type === 'fixed_amount' && promo.discount_value != null) {
    return `${promo.name} −Rp ${Math.round(amount).toLocaleString('en-US')}`;
  }
  if (promo.type === 'bogo') {
    return `${promo.name} (BOGO)`;
  }
  if (promo.type === 'free_product') {
    return `${promo.name} (free gift)`;
  }
  return promo.name;
}

/* --------------------------- percentage -------------------------------- */

/**
 * Percentage off : applies `discount_value`% to the eligible base.
 *  - scope=cart      : base = Σ eligible non-gift line subtotals
 *  - scope=product   : base = Σ matching-product line subtotals
 *  - scope=category  : base = Σ lines whose product belongs to a scope category
 * Capped by `max_discount_amount` if set. Returns null if no eligible base.
 */
export function computePercentage(
  promo: Promotion,
  cart: Cart,
  catalog: PromotionCatalog,
): AppliedPromotion | null {
  if (promo.discount_value == null || promo.discount_value <= 0) return null;
  let base = 0;
  let onlyLineId: string | null = null;
  let multipleLines = false;

  for (const it of cart.items) {
    if (!isCartItemEligibleForPercent(promo, it, catalog)) continue;
    base += lineSubtotal(it);
    if (onlyLineId === null) onlyLineId = it.id;
    else multipleLines = true;
  }

  if (base <= 0) return null;
  let amount = roundHalfUp((base * promo.discount_value) / 100);
  amount = applyMaxCap(amount, promo.max_discount_amount);
  amount = Math.min(amount, base);
  if (amount <= 0) return null;

  return {
    promotion_id: promo.id,
    slug: promo.slug,
    name: promo.name,
    type: promo.type,
    amount,
    description: describePromo(promo, amount),
    ...(promo.scope === 'product' && !multipleLines && onlyLineId
      ? { scope_line_id: onlyLineId }
      : {}),
  };
}

/* --------------------------- fixed_amount ------------------------------ */

/**
 * Fixed IDR off the cart total (always cart-scope semantically — the spec
 * permits scope=cart only for fixed_amount, but we tolerate scope=null for
 * defensive parity with BOGO/free_product). Capped by the eligible base
 * to never push the line total below 0.
 */
export function computeFixed(promo: Promotion, cart: Cart): AppliedPromotion | null {
  if (promo.discount_value == null || promo.discount_value <= 0) return null;
  const base = cart.items.reduce(
    (s, it) => s + (it.is_promo_gift ? 0 : lineSubtotal(it)),
    0,
  );
  if (base <= 0) return null;
  const amount = Math.min(promo.discount_value, base);
  if (amount <= 0) return null;
  return {
    promotion_id: promo.id,
    slug: promo.slug,
    name: promo.name,
    type: promo.type,
    amount,
    description: describePromo(promo, amount),
  };
}

/* ------------------------------- BOGO ---------------------------------- */

/**
 * BOGO — apply N times where
 *   N = floor( min(triggerCount / triggerQty, rewardCount / rewardQty) )
 *
 * Rationale (spec §7 risk row): if a cashier rings 5 croissants for a
 * "buy 2 get 1 50% off" promo, we apply BOGO twice (uses 4 triggers + 2
 * rewards), leaving 1 unmatched croissant at full price. Cross-category
 * supported via the trigger_product_ids / reward_product_ids arrays.
 *
 * The discount per reward unit = unit_price * (reward_discount_pct / 100).
 * We use the reward product's catalog price rather than the cart line's
 * `unit_price` to defend against an off-menu override; falls back to the
 * cart line's own price when catalog is absent. Same products ID being on
 * both lists (buy 2 get 1 same SKU) is supported — we treat trigger and
 * reward pools independently. When the same line counts for both, callers
 * should rely on the `min(...)` cap to avoid double-counting.
 */
export function computeBogo(
  promo: Promotion,
  cart: Cart,
  catalog: PromotionCatalog,
): AppliedPromotion | null {
  if (
    promo.bogo_trigger_qty == null ||
    promo.bogo_reward_qty == null ||
    promo.bogo_reward_discount_pct == null
  ) {
    return null;
  }
  if (promo.bogo_trigger_qty <= 0 || promo.bogo_reward_qty <= 0) return null;

  let triggerCount = 0;
  let rewardCount = 0;
  let rewardUnitPriceSum = 0; // weighted average reference (sum, then divide)

  for (const it of cart.items) {
    if (it.is_promo_gift) continue;
    if (promo.bogo_trigger_product_ids.includes(it.product_id)) {
      triggerCount += it.quantity;
    }
    if (promo.bogo_reward_product_ids.includes(it.product_id)) {
      rewardCount += it.quantity;
      const unit = catalog.productPrice[it.product_id] ?? it.unit_price;
      rewardUnitPriceSum += unit * it.quantity;
    }
  }
  if (triggerCount === 0 || rewardCount === 0) return null;

  // Apply BOGO as many times as the cart allows (spec §7 risk row).
  const triggerCapacity = Math.floor(triggerCount / promo.bogo_trigger_qty);
  const rewardCapacity = Math.floor(rewardCount / promo.bogo_reward_qty);
  const applications = Math.min(triggerCapacity, rewardCapacity);
  if (applications <= 0) return null;

  const rewardUnitsTotal = applications * promo.bogo_reward_qty;
  const avgRewardUnitPrice =
    rewardCount > 0 ? rewardUnitPriceSum / rewardCount : 0;
  const amount = roundHalfUp(
    rewardUnitsTotal * avgRewardUnitPrice * (promo.bogo_reward_discount_pct / 100),
  );
  if (amount <= 0) return null;

  return {
    promotion_id: promo.id,
    slug: promo.slug,
    name: promo.name,
    type: promo.type,
    amount,
    description: `${promo.name} ×${applications}`,
  };
}

/* ---------------------------- free_product ----------------------------- */

/**
 * Free product (gift). Conditions are checked by the evaluator before this
 * is called; here we just shape the AppliedPromotion + gift_to_add payload.
 * `amount` stays 0 — the discount manifests as a gift line (unit_price=0).
 */
export function computeFreeProduct(
  promo: Promotion,
  _cart: Cart,
  _customer: PromotionCustomer | null,
): AppliedPromotion | null {
  if (!promo.gift_product_id || promo.gift_qty <= 0) return null;
  return {
    promotion_id: promo.id,
    slug: promo.slug,
    name: promo.name,
    type: promo.type,
    amount: 0,
    description: `${promo.name} (free ×${promo.gift_qty})`,
    gift_to_add: { product_id: promo.gift_product_id, qty: promo.gift_qty },
  };
}
