// apps/pos/src/features/promotions/hooks/usePromotionsPreview.ts
import { useEffect } from 'react';
import { useEvaluatePromotionsLive } from './useEvaluatePromotionsLive.js';
import { useCartStore } from '@/stores/cartStore';

export function usePromotionsPreview(): void {
  const result = useEvaluatePromotionsLive();
  const setApplied = useCartStore((s) => s.setAppliedPromotion);
  const setPreview = useCartStore((s) => s.setPreviewItems);

  useEffect(() => {
    if (!result) return;
    setApplied(result.applied_promotion);
    setPreview(result.applied_promotion?.items_to_add ?? []);
  }, [result, setApplied, setPreview]);
}
