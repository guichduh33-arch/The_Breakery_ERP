// apps/backoffice/src/features/reports/hooks/useStockVariance.ts
//
// Wraps `get_stock_variance_v1(p_section_id, p_date_start, p_date_end)`.

import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/lib/supabase.js';

export interface StockVarianceRow {
  product_id:    string;
  product_name:  string;
  sku:           string;
  opened:        number;
  sold:          number;
  adjusted:      number;
  current_qty:   number;
  expected:      number;
  variance:      number;
  variance_pct:  number;
}

export interface StockVarianceFilters {
  sectionId?:  string;
  dateStart?:  string; // ISO timestamp
  dateEnd?:    string;
}

export const STOCK_VARIANCE_QK = ['reports', 'stock-variance'] as const;

export function useStockVariance(filters: StockVarianceFilters = {}) {
  return useQuery<StockVarianceRow[]>({
    queryKey: [...STOCK_VARIANCE_QK, filters] as const,
    staleTime: 60_000,
    queryFn: async () => {
      const args: {
        p_section_id?: string;
        p_date_start?: string;
        p_date_end?:   string;
      } = {};
      if (filters.sectionId !== undefined && filters.sectionId !== '') {
        args.p_section_id = filters.sectionId;
      }
      if (filters.dateStart !== undefined && filters.dateStart !== '') {
        args.p_date_start = filters.dateStart;
      }
      if (filters.dateEnd !== undefined && filters.dateEnd !== '') {
        args.p_date_end = filters.dateEnd;
      }
      const { data, error } = await supabase.rpc('get_stock_variance_v1', args);
      if (error) throw error;
      return (data ?? []).map((r) => ({
        product_id:   r.product_id,
        product_name: r.product_name,
        sku:          r.sku,
        opened:       Number(r.opened),
        sold:         Number(r.sold),
        adjusted:     Number(r.adjusted),
        current_qty:  Number(r.current_qty),
        expected:     Number(r.expected),
        variance:     Number(r.variance),
        variance_pct: Number(r.variance_pct),
      }));
    },
  });
}
