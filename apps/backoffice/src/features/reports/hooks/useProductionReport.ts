// apps/backoffice/src/features/reports/hooks/useProductionReport.ts
// S40 Wave B3 — Query hook for get_production_report_v1 RPC.

import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/lib/supabase.js';
import { asArray, asRecord, toNum, toStr } from '../utils/parse.js';

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
      const { data, error } = await supabase.rpc('get_production_report_v1', {
        p_date_start: params.start,
        p_date_end:   params.end,
      });
      if (error) throw error as Error;
      const raw     = asRecord(data);
      const period  = asRecord(raw.period);
      const summary = asRecord(raw.summary);
      return {
        period: {
          start: toStr(period.start, params.start),
          end:   toStr(period.end,   params.end),
        },
        summary: {
          runs:           toNum(summary.runs),
          total_produced: toNum(summary.total_produced),
          total_waste:    toNum(summary.total_waste),
          total_value:    toNum(summary.total_value),
        },
        by_product: asArray(raw.by_product).map((e): ProductionReportByProduct => {
          const o = asRecord(e);
          return {
            product_id:   toStr(o.product_id),
            product_name: toStr(o.product_name, '—'),
            qty_produced: toNum(o.qty_produced),
            qty_waste:    toNum(o.qty_waste),
            value:        toNum(o.value),
            runs:         toNum(o.runs),
          };
        }),
        by_day: asArray(raw.by_day).map((e): ProductionReportByDay => {
          const o = asRecord(e);
          return {
            date:         toStr(o.date),
            qty_produced: toNum(o.qty_produced),
            qty_waste:    toNum(o.qty_waste),
            value:        toNum(o.value),
          };
        }),
      } satisfies ProductionReportData;
    },
    enabled: Boolean(params.start && params.end),
  });
}
