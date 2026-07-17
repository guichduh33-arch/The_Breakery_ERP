// apps/backoffice/src/features/reports/hooks/useSalesByCategory.ts
//
// Wraps `get_sales_by_category_v2(p_date_start, p_date_end)`.
// ADR-009 déc. 4 — bumped v1 → v2 (status IN paid, completed).

import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/lib/supabase.js';

export interface SalesCategoryRow {
  category_id:   string;
  category_name: string;
  total:         number;
  qty:           number;
}

export const SALES_BY_CATEGORY_QK = ['reports', 'sales-by-category'] as const;

export function useSalesByCategory(dateStart: string, dateEnd: string) {
  return useQuery<SalesCategoryRow[]>({
    queryKey: [...SALES_BY_CATEGORY_QK, dateStart, dateEnd] as const,
    staleTime: 60_000,
    queryFn: async () => {
      const { data, error } = await supabase.rpc('get_sales_by_category_v2', {
        p_date_start: dateStart,
        p_date_end:   dateEnd,
      });
      if (error) throw error;
      return (data ?? []).map((r) => ({
        category_id:   r.category_id,
        category_name: r.category_name,
        total:         Number(r.total),
        qty:           Number(r.qty),
      }));
    },
  });
}
