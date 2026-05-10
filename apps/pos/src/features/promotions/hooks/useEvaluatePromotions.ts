// apps/pos/src/features/promotions/hooks/useEvaluatePromotions.ts
//
// Session 9 — thin wrapper around the pure domain `evaluatePromotions`.
// Owns the build of the `PromotionCatalog` (product → category, product → price)
// from the products query so the cart store doesn't have to.
//
// The actual debounced trigger lives in `cartStore.runEvaluation`; this hook
// merely exposes a stable `runEvaluation(cart, customer, dismissedIds)` callback
// that the cart panel can wire on every cart-mutation effect.
import { useCallback, useMemo } from 'react';
import {
  evaluatePromotions,
  type AppliedPromotion,
  type Cart,
  type Promotion,
  type PromotionCatalog,
  type PromotionCustomer,
} from '@breakery/domain';
import { useProducts } from '@/features/products/hooks/useProducts';
import { usePromotions } from './usePromotions';

export interface UseEvaluatePromotionsResult {
  promotions: Promotion[];
  catalog: PromotionCatalog;
  runEvaluation: (
    cart: Cart,
    customer: PromotionCustomer | null,
    dismissedIds?: ReadonlySet<string>,
    now?: Date,
  ) => AppliedPromotion[];
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
    (
      cart: Cart,
      customer: PromotionCustomer | null,
      dismissedIds?: ReadonlySet<string>,
      now: Date = new Date(),
    ): AppliedPromotion[] => {
      if (promotions.length === 0) return [];
      return evaluatePromotions(promotions, cart, customer, now, catalog, {
        ...(dismissedIds ? { dismissedPromotionIds: dismissedIds } : {}),
      });
    },
    [promotions, catalog],
  );

  return { promotions, catalog, runEvaluation };
}
