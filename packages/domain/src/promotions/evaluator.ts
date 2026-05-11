// packages/domain/src/promotions/evaluator.ts
//
// Main evaluator — pure function, deterministic given inputs.
// Spec ref: 2026-05-10-session-9-promotions-spec.md §1 P11, §4.1, §4.4

import type { Cart } from '../types/index.js';
import { matchAllConditions } from './matchers.js';
import {
  computeBogo,
  computeFixed,
  computeFreeProduct,
  computePercentage,
} from './computeAmount.js';
import type {
  AppliedPromotion,
  Promotion,
  PromotionCatalog,
  PromotionCustomer,
} from './types.js';

export interface EvaluatePromotionsOptions {
  /**
   * Promotion ids dismissed by the user during this cart session (typically
   * gifts the user manually removed). Re-evaluation skips them entirely so
   * we don't re-add the gift in a removeItem → re-eval loop.
   * Spec ref §7 risk row "Gift product retiré accidentellement".
   */
  dismissedPromotionIds?: ReadonlySet<string>;
}

/**
 * Stage 1 — filter eligibility (active, not soft-deleted, all matchers pass,
 * not on the dismissed list).
 */
function filterEligible(
  promotions: Promotion[],
  cart: Cart,
  customer: PromotionCustomer | null,
  now: Date,
  dismissed: ReadonlySet<string>,
): Promotion[] {
  return promotions.filter((p) => {
    if (!p.is_active) return false;
    if (dismissed.has(p.id)) return false;
    return matchAllConditions(p, cart, customer, now);
  });
}

/**
 * Stage 2 — compute amount per type. Promos that yield no positive amount
 * (e.g. percentage on a cart with no eligible product, BOGO without enough
 * triggers, gift with missing product) are dropped.
 */
function computeApplied(
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
      return computeBogo(promo, cart, catalog);
    case 'free_product':
      return computeFreeProduct(promo, cart, customer);
    /* c8 ignore next 2 — TypeScript exhaustive guard */
    default:
      return null;
  }
}

/**
 * Stage 3 — sort by `priority` desc, tie-break `created_at` desc (most
 * recently created promo wins ties — matches DB `idx_promotions_active`).
 */
function sortByPriority(a: AppliedPromotion, b: AppliedPromotion, lookup: Map<string, Promotion>): number {
  const pa = lookup.get(a.promotion_id);
  const pb = lookup.get(b.promotion_id);
  /* c8 ignore next 2 — both should always be present */
  if (!pa || !pb) return 0;
  if (pa.priority !== pb.priority) return pb.priority - pa.priority;
  return new Date(pb.created_at).getTime() - new Date(pa.created_at).getTime();
}

/**
 * Stage 4 — apply stacking matrix (spec P11):
 *   - First eligible promo (after sort) is always applied.
 *   - Subsequent promos are applied only if BOTH the first applied promo
 *     AND the candidate have `stackable_with_promo=true`.
 *   - Manual cart/line discount stacking is enforced downstream by the cart
 *     store (filtering on `stackable_with_manual` when a manual discount is
 *     present). The evaluator returns the AppliedPromotion[] regardless;
 *     the cart store may further filter.
 */
function applyStacking(
  applied: AppliedPromotion[],
  lookup: Map<string, Promotion>,
): AppliedPromotion[] {
  if (applied.length === 0) return [];
  const out: AppliedPromotion[] = [];
  let firstStackable: boolean | null = null;
  for (const ap of applied) {
    const promo = lookup.get(ap.promotion_id);
    /* c8 ignore next */
    if (!promo) continue;
    if (out.length === 0) {
      out.push(ap);
      firstStackable = promo.stackable_with_promo;
      continue;
    }
    if (firstStackable === true && promo.stackable_with_promo === true) {
      out.push(ap);
    }
    // else: skipped (non-stackable with already-applied promo)
  }
  return out;
}

/**
 * Evaluate the full set of `promotions` against `(cart, customer, now)` and
 * return the ordered list of AppliedPromotion to display + persist. Pure.
 *
 * @param promotions raw rows from `promotions` (will be filtered for active +
 *                   non-deleted; soft-deleted rows are expected to be filtered
 *                   upstream by the query but we double-guard via `is_active`)
 * @param cart       current cart
 * @param customer   attached customer profile or null
 * @param now        evaluation timestamp (injected for determinism in tests)
 * @param catalog    product → category / price lookup
 * @param options    dismissed promo ids etc.
 */
export function evaluatePromotions(
  promotions: Promotion[],
  cart: Cart,
  customer: PromotionCustomer | null,
  now: Date,
  catalog: PromotionCatalog,
  options: EvaluatePromotionsOptions = {},
): AppliedPromotion[] {
  const dismissed = options.dismissedPromotionIds ?? new Set<string>();

  // 1. Filter eligible
  const eligible = filterEligible(promotions, cart, customer, now, dismissed);
  if (eligible.length === 0) return [];

  // 2. Compute amounts
  const lookup = new Map<string, Promotion>();
  const computed: AppliedPromotion[] = [];
  for (const p of eligible) {
    const ap = computeApplied(p, cart, customer, catalog);
    if (!ap) continue;
    lookup.set(p.id, p);
    computed.push(ap);
  }
  if (computed.length === 0) return [];

  // 3. Sort priority desc, created_at desc
  computed.sort((a, b) => sortByPriority(a, b, lookup));

  // 4. Apply stacking
  return applyStacking(computed, lookup);
}
