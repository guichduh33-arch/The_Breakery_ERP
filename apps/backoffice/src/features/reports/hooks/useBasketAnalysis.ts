// apps/backoffice/src/features/reports/hooks/useBasketAnalysis.ts
//
// Wraps `get_basket_analysis_v2(p_date_start, p_date_end, p_top_n)`.
// ADR-009 déc. 4 — bumped v1 → v2 (status IN paid, completed).

import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/lib/supabase.js';

export interface BasketPair {
  product_id_a:        string;
  product_a_name:      string;
  product_id_b:        string;
  product_b_name:      string;
  co_occurrence_count: number;
  support_a:           number;
  support_b:           number;
  support_pair:        number;
  confidence:          number;
  lift:                number;
}

export const BASKET_ANALYSIS_QK = ['reports', 'basket-analysis'] as const;

export function useBasketAnalysis(
  dateStart: string,
  dateEnd:   string,
  topN       = 10,
) {
  return useQuery<BasketPair[]>({
    queryKey: [...BASKET_ANALYSIS_QK, dateStart, dateEnd, topN] as const,
    staleTime: 60_000,
    queryFn: async () => {
      const { data, error } = await supabase.rpc('get_basket_analysis_v2', {
        p_date_start: dateStart,
        p_date_end:   dateEnd,
        p_top_n:      topN,
      });
      if (error) throw error;
      return (data ?? []).map((r) => ({
        product_id_a:        String(r.product_id_a),
        product_a_name:      String(r.product_a_name),
        product_id_b:        String(r.product_id_b),
        product_b_name:      String(r.product_b_name),
        co_occurrence_count: Number(r.co_occurrence_count),
        support_a:           Number(r.support_a),
        support_b:           Number(r.support_b),
        support_pair:        Number(r.support_pair),
        confidence:          Number(r.confidence),
        lift:                Number(r.lift),
      }));
    },
  });
}
