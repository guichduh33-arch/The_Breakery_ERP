// apps/backoffice/src/features/marketing/hooks/usePromoRoi.ts
//
// Wraps `get_promo_roi_v1(p_promotion_id, p_date_start, p_date_end)` RPC.
// Returns ROI summary jsonb for a single promotion in the date range.
//
// Note : `incremental_revenue` is a proxy (revenue minus discount).
// True incrementality would require a control-group experiment.
//
// Session 13 / Phase 6.B (see deviation D-W6-6B-05).

import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/lib/supabase.js';

export interface PromoRoi {
  promotion_id:           string;
  code:                   string;
  name:                   string;
  redemptions:            number;
  incremental_orders:     number;
  total_discount_given:   number;
  total_revenue:          number;
  incremental_revenue:    number;
  estimated_cost:         number;
  roi_pct:                number;
  period: { start: string; end: string };
}

export const PROMO_ROI_QUERY_KEY = ['marketing', 'promo-roi'] as const;

export function usePromoRoi(
  promotionId: string | null,
  dateStart:   string,
  dateEnd:     string,
) {
  return useQuery<PromoRoi | null>({
    queryKey: [...PROMO_ROI_QUERY_KEY, promotionId, dateStart, dateEnd] as const,
    staleTime: 60_000,
    enabled:   promotionId !== null && promotionId.length > 0,
    queryFn: async () => {
      if (promotionId === null || promotionId.length === 0) return null;
      const { data, error } = await supabase.rpc('get_promo_roi_v1', {
        p_promotion_id: promotionId,
        p_date_start:   dateStart,
        p_date_end:     dateEnd,
      });
      if (error) throw error;
      // RPC returns a jsonb scalar.
      return (data ?? null) as PromoRoi | null;
    },
  });
}
