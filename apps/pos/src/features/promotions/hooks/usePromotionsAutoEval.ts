// apps/pos/src/features/promotions/hooks/usePromotionsAutoEval.ts
//
// Session 9 — orchestrator hook that ties the pure domain evaluator
// (`useEvaluatePromotions`) to the cart store. Re-runs the eval whenever the
// cart, attached customer, or dismissal set changes (debounced 200ms per
// spec §4.4) and pushes the result into `cartStore.setAppliedPromotions`,
// surfacing toasts for added/removed gift lines.
//
// The orchestrator must be mounted exactly once at the cart panel scope
// (`<ActiveOrderPanel>`) so that we have a single source of truth for
// promotion sync. Mounting twice would race `setAppliedPromotions` calls.
import { useEffect, useRef } from 'react';
import { toast } from 'sonner';
import { useCartStore } from '@/stores/cartStore';
import { useProducts } from '@/features/products/hooks/useProducts';
import { useEvaluatePromotions } from './useEvaluatePromotions';

/** Debounce window applied to the cart-mutation eval (spec §4.4 step 1). */
const DEBOUNCE_MS = 200;

export function usePromotionsAutoEval(): void {
  const cart = useCartStore((s) => s.cart);
  const attachedCustomer = useCartStore((s) => s.attachedCustomer);
  const dismissedPromotionIds = useCartStore((s) => s.dismissedPromotionIds);
  const setAppliedPromotions = useCartStore((s) => s.setAppliedPromotions);

  const productsQuery = useProducts();
  const { promotions, runEvaluation } = useEvaluatePromotions();

  // Stable timer ref — debounced trigger across cart mutations.
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (timerRef.current !== null) clearTimeout(timerRef.current);

    timerRef.current = setTimeout(() => {
      // No promotions loaded yet (initial query) → nothing to apply.
      // Note: Session 13 / Phase 2.C — even with zero TS-cached
      // promotions, the RPC may still apply server-side promos. We keep
      // this short-circuit for safety, but the RPC path inside
      // `runEvaluation` is the source of truth in steady state.
      if (promotions.length === 0) {
        setAppliedPromotions([]);
        return;
      }

      const customer = attachedCustomer
        ? {
            id: attachedCustomer.id,
            ...(attachedCustomer.category?.id
              ? { category_id: attachedCustomer.category.id }
              : {}),
          }
        : null;

      // `runEvaluation` is now async (RPC-first, TS fallback).
      // We fire-and-await inside the setTimeout callback; any RPC
      // error is already logged inside the hook.
      void runEvaluation(cart, customer, dismissedPromotionIds).then((next) => {
        const productLookup: Record<string, { name: string }> = {};
        for (const p of productsQuery.data ?? []) {
          productLookup[p.id] = { name: p.name };
        }
        const { addedGifts, removedGifts } = setAppliedPromotions(next, productLookup);
        for (const g of addedGifts) toast.success(`Free ${g.name} added`);
        for (const g of removedGifts) {
          toast.info(`Free ${g.name} removed (condition no longer met)`);
        }
      });
    }, DEBOUNCE_MS);

    return () => {
      if (timerRef.current !== null) clearTimeout(timerRef.current);
    };
  }, [
    cart,
    attachedCustomer,
    dismissedPromotionIds,
    promotions,
    productsQuery.data,
    runEvaluation,
    setAppliedPromotions,
  ]);
}
