// apps/backoffice/src/features/reports/hooks/useProductionReport.ts
// S40 Wave B3 — Query hook for get_production_report_v1 RPC.

import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/lib/supabase.js';

export interface ProductionReportByProduct {
  product_id:   string;
  product_name: string;
  qty_produced: number;
  qty_waste:    number;
  value:        number;
  runs:         number;
}

export interface ProductionReportByDay {
  date:         string;
  qty_produced: number;
  qty_waste:    number;
  value:        number;
}

export interface ProductionReportSummary {
  runs:          number;
  total_produced: number;
  total_waste:   number;
  total_value:   number;
}

export interface ProductionReportData {
  period:     { start: string; end: string };
  summary:    ProductionReportSummary;
  by_product: ProductionReportByProduct[];
  by_day:     ProductionReportByDay[];
}

export interface UseProductionReportParams {
  start: string;
  end:   string;
}

export function useProductionReport(params: UseProductionReportParams) {
  return useQuery<ProductionReportData, Error>({
    queryKey: ['reports', 'production', params.start, params.end],
    queryFn:  async () => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const { data, error } = await (supabase as any).rpc('get_production_report_v1', {
        p_date_start: params.start,
        p_date_end:   params.end,
      });
      if (error) throw error as Error;
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const raw = (data ?? {}) as any;
      return {
        period:     raw.period     ?? { start: params.start, end: params.end },
        summary:    raw.summary    ?? { runs: 0, total_produced: 0, total_waste: 0, total_value: 0 },
        by_product: raw.by_product ?? [],
        by_day:     raw.by_day     ?? [],
      } satisfies ProductionReportData;
    },
    enabled: Boolean(params.start && params.end),
  });
}
