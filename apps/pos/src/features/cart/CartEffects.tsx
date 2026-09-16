import { usePromotionsAutoEval } from '@/features/promotions/hooks/usePromotionsAutoEval';
import { usePromotionsRealtime } from '@/features/promotions/hooks/usePromotionsRealtime';
import { useCartBroadcast } from '@/features/display/hooks/useCartBroadcast';
import { useTaxConfig } from '@/features/settings/hooks/useTaxConfig';

/** Keep order effects alive when the responsive cart drawer is closed. */
export function CartEffects() {
  const { taxRate, taxInclusive } = useTaxConfig();
  usePromotionsAutoEval();
  usePromotionsRealtime();
  useCartBroadcast(taxRate, taxInclusive);
  return null;
}
