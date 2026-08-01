// apps/backoffice/src/features/reports/hooks/useSalesByCategory.ts
//
// Wraps `get_sales_by_category_v3(p_date_start, p_date_end)`.
// ADR-009 déc. 4 — bumped v1 → v2 (status IN paid, completed).
// Audit Reports 2026-08-01 lot C / D1 — bumped v2 -> v3 : la v2 etait SECURITY
// INVOKER sans gate, donc lisible par tout compte authentifie (la RLS de
// `orders` a pour predicat is_authenticated()). v3 est SECURITY DEFINER et
// gatee sur reports.sales.read.

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
      const { data, error } = await supabase.rpc('get_sales_by_category_v3', {
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
