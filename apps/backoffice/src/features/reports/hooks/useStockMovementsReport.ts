// apps/backoffice/src/features/reports/hooks/useStockMovementsReport.ts
// S30 Wave 4.1 — InfiniteQuery hook for get_stock_movements_v1 RPC (cursor-based pagination).
// Named useStockMovementsReport (not useStockMovements) to avoid collision with the
// existing inventory hook in features/inventory.

import { useInfiniteQuery } from '@tanstack/react-query';
import { supabase } from '@/lib/supabase.js';

export interface StockMovementLine {
  id:               string;
  product_name:     string;
  movement_type:    string;
  quantity:         number;
  unit_cost:        number | null;
  value:            number;
  reference_type:   string | null;
  reference_id:     string | null;
  created_by_name:  string | null;
  created_at:       string;
}

export interface StockMovementsPage {
  lines:       StockMovementLine[];
  next_cursor: string | null;
}

export interface UseStockMovementsReportParams {
  start:          string;
  end:            string;
  product_id?:    string;
  movement_type?: string;
  limit?:         number;
}

export function useStockMovementsReport(params: UseStockMovementsReportParams) {
  return useInfiniteQuery<StockMovementsPage, Error>({
    queryKey: ['reports', 'stock_movements', params],
    queryFn:  async ({ pageParam }) => {
      const { data, error } = await supabase.rpc('get_stock_movements_v1', {
        p_start:         params.start,
        p_end:           params.end,
        p_product_id:    params.product_id    ?? null,
        p_movement_type: params.movement_type ?? null,
        p_limit:         params.limit         ?? 50,
        p_cursor:        (pageParam as string | null) ?? null,
      });
      if (error) throw error;
      return data as StockMovementsPage;
    },
    initialPageParam: null as string | null,
    getNextPageParam: (lastPage) => lastPage.next_cursor ?? undefined,
    enabled: Boolean(params.start && params.end),
  });
}
