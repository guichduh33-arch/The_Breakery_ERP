// apps/backoffice/src/features/reports/hooks/useProductionEfficiency.ts
// S40 Wave B3 — Query hook for get_production_efficiency_v1 RPC.

import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/lib/supabase.js';

export interface ProductionEfficiencyByProduct {
  product_id:              string;
  product_name:            string;
  runs:                    number;
  avg_yield_variance_pct:  number | null;
  worst_variance_pct:      number | null;
  waste_rate_pct:          number | null;
  has_variance_reasons:    boolean;
}

export interface ProductionEfficiencyByDay {
  date:                   string;
  avg_yield_variance_pct: number | null;
  waste_rate_pct:         number | null;
}

export interface ProductionEfficiencyData {
  period:     { start: string; end: string };
  by_product: ProductionEfficiencyByProduct[];
  by_day:     ProductionEfficiencyByDay[];
}

export interface UseProductionEfficiencyParams {
  start: string;
  end:   string;
}

export function useProductionEfficiency(params: UseProductionEfficiencyParams) {
  return useQuery<ProductionEfficiencyData, Error>({
    queryKey: ['reports', 'production-efficiency', params.start, params.end],
    queryFn:  async () => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const { data, error } = await (supabase as any).rpc('get_production_efficiency_v1', {
        p_date_start: params.start,
        p_date_end:   params.end,
      });
      if (error) throw error as Error;
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const raw = (data ?? {}) as any;
      return {
        period:     raw.period     ?? { start: params.start, end: params.end },
        by_product: raw.by_product ?? [],
        by_day:     raw.by_day     ?? [],
      } satisfies ProductionEfficiencyData;
    },
    enabled: Boolean(params.start && params.end),
  });
}
