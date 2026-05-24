// apps/backoffice/src/features/reports/hooks/usePerishableTurnover.ts
// S30 Wave 4.1 — Query hook for get_perishable_turnover_v1 RPC.

import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/lib/supabase.js';

export interface PerishableTurnoverLine {
  product_id:          string;
  product_name:        string;
  lots_count:          number;
  consumed_qty:        number;
  expired_qty:         number;
  current_active_qty:  number;
  waste_pct:           number;
  avg_days_in_stock:   number | null;
  shelf_life_days_p50: number | null;
  velocity_score:      number;
}

export interface PerishableTurnoverData {
  period:     { start: string; end: string };
  by_product: PerishableTurnoverLine[];
}

export interface UsePerishableTurnoverParams {
  start: string;
  end:   string;
}

export function usePerishableTurnover(params: UsePerishableTurnoverParams) {
  return useQuery<PerishableTurnoverData, Error>({
    queryKey: ['reports', 'perishable_turnover', params.start, params.end],
    queryFn:  async () => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const { data, error } = await (supabase as any).rpc('get_perishable_turnover_v1', {
        p_start: params.start,
        p_end:   params.end,
      });
      if (error) throw error as Error;
      return data as PerishableTurnoverData;
    },
    enabled: Boolean(params.start && params.end),
  });
}
