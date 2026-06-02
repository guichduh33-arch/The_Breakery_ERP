// apps/backoffice/src/features/reports/hooks/useStockMovementsReport.ts
// S30 Wave 4.1 — InfiniteQuery hook for get_stock_movements_v2 RPC (cursor-based pagination).
// M9(a) — bumped v1 → v2 : composite keyset cursor "<created_at>|<id>" (TEXT). The
// next_cursor/p_cursor were already typed string here (timestamptz serialized to
// string by PostgREST), so the v2 opaque token is transparent to this hook.
// Named useStockMovementsReport (not useStockMovements) to avoid collision with the
// existing inventory hook in features/inventory.

import { useInfiniteQuery } from '@tanstack/react-query';
import { supabase } from '@/lib/supabase.js';

export interface StockMovementLine {
  id:               string;
  product_id:       string; // S32 — exposed by RPC since S30, DEV-S31-3.B-01 fix
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
  product_id?:    string | undefined;
  movement_type?: string | undefined;
  limit?:         number | undefined;
}

export function useStockMovementsReport(params: UseStockMovementsReportParams) {
  return useInfiniteQuery<StockMovementsPage, Error>({
    queryKey: ['reports', 'stock_movements', params],
    queryFn:  async ({ pageParam }) => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const { data, error } = await (supabase as any).rpc('get_stock_movements_v2', {
        p_start:         params.start,
        p_end:           params.end,
        p_product_id:    params.product_id    ?? null,
        p_movement_type: params.movement_type ?? null,
        p_limit:         params.limit         ?? 50,
        p_cursor:        (pageParam as string | null) ?? null,
      });
      if (error) throw error as Error;
      return data as unknown as StockMovementsPage;
    },
    initialPageParam: null as string | null,
    getNextPageParam: (lastPage) => lastPage.next_cursor ?? undefined,
    enabled: Boolean(params.start && params.end),
  });
}
