// apps/backoffice/src/features/reports/hooks/useProductionEfficiency.ts
// S40 Wave B3 — Query hook for get_production_efficiency_v1 RPC.

import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/lib/supabase.js';
import { asArray, asRecord, toNum, toStr } from '../utils/parse.js';

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
      const { data, error } = await supabase.rpc('get_production_efficiency_v1', {
        p_date_start: params.start,
        p_date_end:   params.end,
      });
      if (error) throw error as Error;
      const raw    = asRecord(data);
      const period = asRecord(raw.period);
      return {
        period: {
          start: toStr(period.start, params.start),
          end:   toStr(period.end,   params.end),
        },
        by_product: asArray(raw.by_product).map((e): ProductionEfficiencyByProduct => {
          const o = asRecord(e);
          return {
            product_id:             toStr(o.product_id),
            product_name:           toStr(o.product_name, '—'),
            runs:                   toNum(o.runs),
            avg_yield_variance_pct: o.avg_yield_variance_pct == null ? null : toNum(o.avg_yield_variance_pct),
            worst_variance_pct:     o.worst_variance_pct     == null ? null : toNum(o.worst_variance_pct),
            waste_rate_pct:         o.waste_rate_pct         == null ? null : toNum(o.waste_rate_pct),
            has_variance_reasons:   o.has_variance_reasons === true,
          };
        }),
        by_day: asArray(raw.by_day).map((e): ProductionEfficiencyByDay => {
          const o = asRecord(e);
          return {
            date:                   toStr(o.date),
            avg_yield_variance_pct: o.avg_yield_variance_pct == null ? null : toNum(o.avg_yield_variance_pct),
            waste_rate_pct:         o.waste_rate_pct         == null ? null : toNum(o.waste_rate_pct),
          };
        }),
      } satisfies ProductionEfficiencyData;
    },
    enabled: Boolean(params.start && params.end),
  });
}
