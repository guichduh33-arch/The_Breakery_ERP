// apps/pos/src/features/promotions/hooks/useEvaluatePromotions.ts
//
// Session 13 / Phase 2.C — RPC-first promo evaluation with TS fallback.
//
// Builds the `PromotionCatalog` (product → category / price) from the
// products query and exposes a stable `runEvaluation(cart, customer,
// dismissedIds, now)` callback.
//
// Evaluation order:
//   1. Call `supabase.rpc('evaluate_promotions_v1', { p_cart_items, p_customer_id, p_subtotal })`.
//      The RPC mirrors `packages/domain/src/promotions/bogoEngine.ts` and
//      knows about every shape (percentage / fixed_amount / bogo legacy /
//      bogo new / threshold / bundle / free_product).
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

/** Server-side payload shape emitted by `evaluate_promotions_v1`. */
interface EvaluatePromotionsV1Payload {
  applied_promotions: Array<{
    promotion_id: string;
    slug: string;
    name: string;
    type: PromotionType;
    discount_amount: number;
    description?: string;
    free_items?: Array<{ product_id: string; quantity: number }>;
  }>;
  subtotal_before: number;
  subtotal_after_discount: number;
  total_discount: number;
}

/**
 * Convert the SQL RPC payload to the TS `AppliedPromotion[]` shape
 * the cart store already consumes. For each applied promo whose
 * `free_items[]` has at least one entry, we also seed `gift_to_add`
 * with the first free item so the cart-store auto-add path fires
 * (it's the existing single-gift convention from Session 9).
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
    out.push({
      promotion_id: ap.promotion_id,
      slug: ap.slug,
      name: ap.name,
      type: ap.type,
      amount: Number(ap.discount_amount ?? 0),
      description: ap.description ?? ap.name,
      ...(freeItems && freeItems.length > 0 ? { free_items: freeItems } : {}),
      ...(giftToAdd ? { gift_to_add: giftToAdd } : {}),
    });
  }
  return out;
}

/** Build `p_cart_items` JSON payload from a domain `Cart`. */
function cartToRpcPayload(cart: Cart): Array<{
  line_id: string;
  product_id: string;
  quantity: number;
  unit_price: number;
  is_promo_gift?: boolean;
}> {
  return cart.items.map((it) => ({
    line_id: it.id,
    product_id: it.product_id,
    quantity: it.quantity,
    unit_price: it.unit_price,
    ...(it.is_promo_gift ? { is_promo_gift: true } : {}),
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
        const { data, error } = await supabase.rpc('evaluate_promotions_v1', rpcArgs);
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
        return evaluatePromotionsFallback(promotions, cart, customer, now, catalog, {
          ...(dismissedIds ? { dismissedPromotionIds: dismissedIds } : {}),
        });
      }
    },
    [promotions, catalog],
  );

  return { promotions, catalog, runEvaluation };
}
