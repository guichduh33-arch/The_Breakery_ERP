// apps/pos/src/features/promotions/hooks/useEvaluatePromotions.ts
//
// Session 13 / Phase 2.C — RPC-first promo evaluation with TS fallback.
//
// Builds the `PromotionCatalog` (product → category / price) from the
// products query and exposes a stable `runEvaluation(cart, customer,
// dismissedIds, now)` callback.
//
// Evaluation order:
//   1. Call `supabase.rpc('evaluate_promotions_v2', { p_cart_items, p_customer_id, p_subtotal })`.
//      The RPC mirrors `packages/domain/src/promotions/bogoEngine.ts` and
//      knows about every shape (percentage / fixed_amount / bogo legacy /
//      bogo new / threshold / bundle / free_product). Session 57 (A-D5): v2
//      additionally filters out promotions that have hit their usage cap
//      (max_uses / max_uses_per_customer) — advisory only, the atomic hard
//      gate lives in complete_order_with_payment_v17. The TS fallback below
//      has NO knowledge of usage caps (A-D10 — server is the reference).
//   2. On RPC error (network / RLS / function missing in older envs),
//      fall back to the pure-TS `evaluatePromotionsFallback`.
//
// The hook still returns the *same* `AppliedPromotion[]` shape consumed
// by `cartStore.setAppliedPromotions`, so no cart-store changes are
// needed (see deviation D-W2-2C-02). The RPC's `free_items[]` is
// converted to the existing `gift_to_add` shape so gift lines auto-add
// without further code paths.
import { useCallback, useMemo } from 'react';
import {
  evaluatePromotionsFallback,
  type AppliedFreeProduct,
  type AppliedPromotion,
  type Cart,
  type Promotion,
  type PromotionCatalog,
  type PromotionCustomer,
  type PromotionType,
} from '@breakery/domain';
import { useProducts } from '@/features/products/hooks/useProducts';
import { supabase } from '@/lib/supabase';
import { usePromotions } from './usePromotions';

export interface UseEvaluatePromotionsResult {
  promotions: Promotion[];
  catalog: PromotionCatalog;
  /**
   * Runs the evaluator. Always returns a Promise — the RPC path is
   * async and the fallback path resolves immediately. Callers that
   * previously consumed a sync array should await the result.
   */
  runEvaluation: (
    cart: Cart,
    customer: PromotionCustomer | null,
    dismissedIds?: ReadonlySet<string>,
    now?: Date,
  ) => Promise<AppliedPromotion[]>;
}

/** Server-side payload shape emitted by `evaluate_promotions_v2`. */
interface EvaluatePromotionsV1Payload {
  applied_promotions: {
    promotion_id: string;
    slug: string;
    name: string;
    type: PromotionType;
    discount_amount: number;
    description?: string;
    free_items?: { product_id: string; quantity: number }[];
  }[];
  subtotal_before: number;
  subtotal_after_discount: number;
  total_discount: number;
}

/**
 * Honour the {@link AppliedPromotion} contract (see `types.ts`): a promotion
 * that hands the customer a free gift line (`gift_to_add` / non-empty
 * `free_items`) realises its discount AS that `unit_price=0` cart line. Its
 * monetary `amount` MUST therefore be 0 — otherwise the cart subtracts the
 * gift value twice (once via the 0-priced line, once via `amount`), which is
 * exactly the "Buy 2 Get 1 Free discount exceeds the subtotal" bug.
 *
 * Both the `evaluate_promotions_v2` RPC and the new-shape BOGO TS fallback
 * (`evaluateBogoNew`) emit `amount > 0` alongside a gift, so we normalise here
 * — the single boundary every cart total flows through (Bug 1, Session 36).
 * Non-gift promos (percentage / fixed / threshold / bundle / classic BOGO) are
 * untouched: their `amount` is the only expression of the discount.
 */
export function zeroGiftDiscountAmount(ap: AppliedPromotion): AppliedPromotion {
  const hasGift = Boolean(ap.gift_to_add) || (ap.free_items?.length ?? 0) > 0;
  return hasGift && ap.amount !== 0 ? { ...ap, amount: 0 } : ap;
}

/**
 * Convert the SQL RPC payload to the TS `AppliedPromotion[]` shape
 * the cart store already consumes. For each applied promo whose
 * `free_items[]` has at least one entry, we also seed `gift_to_add`
 * with the first free item so the cart-store auto-add path fires
 * (it's the existing single-gift convention from Session 9).
 *
 * Gift-bearing promos are run through {@link zeroGiftDiscountAmount} so their
 * `amount` is 0 — the free line is the discount, never double-counted.
 */
export function normalizeV1Payload(
  payload: EvaluatePromotionsV1Payload,
  dismissedIds?: ReadonlySet<string>,
): AppliedPromotion[] {
  const out: AppliedPromotion[] = [];
  for (const ap of payload.applied_promotions) {
    if (dismissedIds?.has(ap.promotion_id)) continue;
    const freeItems: AppliedFreeProduct[] | undefined = ap.free_items?.map(
      (fi) => ({ product_id: fi.product_id, qty: fi.quantity }),
    );
    const giftToAdd: AppliedFreeProduct | undefined = freeItems?.[0];
    out.push(
      zeroGiftDiscountAmount({
        promotion_id: ap.promotion_id,
        slug: ap.slug,
        name: ap.name,
        type: ap.type,
        amount: Number(ap.discount_amount ?? 0),
        description: ap.description ?? ap.name,
        ...(freeItems && freeItems.length > 0 ? { free_items: freeItems } : {}),
        ...(giftToAdd ? { gift_to_add: giftToAdd } : {}),
      }),
    );
  }
  return out;
}

/**
 * Build `p_cart_items` JSON payload from a domain `Cart`.
 *
 * Promo gift lines (`is_promo_gift`) are deliberately excluded: they are an
 * OUTPUT of the evaluator, not an input. Feeding them back into the RPC made
 * each re-evaluation count the gift as another eligible unit, inflating the
 * discount on every pass (−75k → −150k → …) — the "promo discount accumulates"
 * half of Bug 1 (Session 36). The TS fallback already ignores gift lines
 * everywhere (`nonGiftSubtotal` / `is_promo_gift` guards), so this keeps both
 * evaluation paths idempotent and aligned.
 */
export function cartToRpcPayload(cart: Cart): {
  line_id: string;
  product_id: string;
  quantity: number;
  unit_price: number;
}[] {
  return cart.items
    .filter((it) => !it.is_promo_gift)
    .map((it) => ({
      line_id: it.id,
      product_id: it.product_id,
      quantity: it.quantity,
      unit_price: it.unit_price,
    }));
}

export function useEvaluatePromotions(): UseEvaluatePromotionsResult {
  const promotionsQuery = usePromotions();
  const productsQuery = useProducts();

  const catalog: PromotionCatalog = useMemo(() => {
    const productCategory: Record<string, string> = {};
    const productPrice: Record<string, number> = {};
    for (const p of productsQuery.data ?? []) {
      if (p.category_id) productCategory[p.id] = p.category_id;
      productPrice[p.id] = p.retail_price;
    }
    return { productCategory, productPrice };
  }, [productsQuery.data]);

  const promotions = useMemo(
    () => promotionsQuery.data ?? [],
    [promotionsQuery.data],
  );

  const runEvaluation = useCallback(
    async (
      cart: Cart,
      customer: PromotionCustomer | null,
      dismissedIds?: ReadonlySet<string>,
      now: Date = new Date(),
    ): Promise<AppliedPromotion[]> => {
      if (cart.items.length === 0) return [];

      // 1. Try the RPC. The function is SECURITY DEFINER + GRANT EXECUTE
      //    on authenticated, so it works under PIN-JWT auth.
      try {
        const subtotal = cart.items.reduce(
          (s, it) => (it.is_promo_gift ? s : s + it.unit_price * it.quantity),
          0,
        );
        // Note: supabase-js types optional UUID args as `string | undefined`
        // — passing `null` won't compile even though the RPC accepts NULL.
        // Using `undefined` triggers PostgREST to omit the arg → DEFAULT
        // value (`NULL`) on the SQL side.
        const rpcArgs: {
          p_cart_items: ReturnType<typeof cartToRpcPayload>;
          p_subtotal: number;
          p_customer_id?: string;
        } = {
          p_cart_items: cartToRpcPayload(cart),
          p_subtotal: subtotal,
          ...(customer?.id ? { p_customer_id: customer.id } : {}),
        };
        const { data, error } = await supabase.rpc('evaluate_promotions_v2', rpcArgs);
        if (error) throw error;
        if (data) {
          // supabase-js types this as `Json`; narrow defensively.
          const payload = data as unknown as EvaluatePromotionsV1Payload;
          return normalizeV1Payload(payload, dismissedIds);
        }
        // Empty payload → treat as no promotions applied.
        return [];
      } catch (rpcErr) {
        // 2. Fall back to pure TS engine. Pure & deterministic, identical
        //    case matrix as the SQL function. We swallow the RPC error
        //    after logging because the user-facing path must still work
        //    even when the function is missing or staging is unreachable.
        // eslint-disable-next-line no-console
        console.warn(
          '[useEvaluatePromotions] RPC failed, using TS fallback',
          rpcErr,
        );
        if (promotions.length === 0) return [];
        // The new-shape BOGO fallback (`evaluateBogoNew`) emits amount>0
        // alongside a gift line, just like the RPC — normalise it the same way
        // so the gift discount is never double-counted (Bug 1, Session 36).
        return evaluatePromotionsFallback(promotions, cart, customer, now, catalog, {
          ...(dismissedIds ? { dismissedPromotionIds: dismissedIds } : {}),
        }).map(zeroGiftDiscountAmount);
      }
    },
    [promotions, catalog],
  );

  return { promotions, catalog, runEvaluation };
}
