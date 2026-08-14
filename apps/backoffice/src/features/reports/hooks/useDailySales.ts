// apps/backoffice/src/features/reports/hooks/useDailySales.ts
// S40 Wave B1 — Query hook for get_daily_sales_v1 RPC.

import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/lib/supabase.js';
import { asArray, asRecord, toNum, toStr } from '../utils/parse.js';

export interface DailySalesRow {
  date:        string;
  order_count: number;
  gross:       number;
  refunds:     number;
  net:         number;
  aov:         number;
}

export interface DailySalesSummary {
  total:        number;
  order_count:  number;
  aov:          number;
  refund_total: number;
  net:          number;
}

export interface DailySalesData {
  period:  { start: string; end: string };
  summary: DailySalesSummary;
  by_day:  DailySalesRow[];
}

export interface UseDailySalesParams {
  start: string;
  end:   string;
}

export function useDailySales(params: UseDailySalesParams) {
  return useQuery<DailySalesData, Error>({
    queryKey: ['reports', 'daily-sales', params.start, params.end],
    queryFn:  async () => {
      const { data, error } = await supabase.rpc('get_daily_sales_v1', {
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
          total:        toNum(summary.total),
          order_count:  toNum(summary.order_count),
          aov:          toNum(summary.aov),
          refund_total: toNum(summary.refund_total),
          net:          toNum(summary.net),
        },
        by_day: asArray(raw.by_day).map((r): DailySalesRow => {
          const o = asRecord(r);
          return {
            date:        toStr(o.date),
            order_count: toNum(o.order_count),
            gross:       toNum(o.gross),
            refunds:     toNum(o.refunds),
            net:         toNum(o.net),
            aov:         toNum(o.aov),
          };
        }),
      } satisfies DailySalesData;
    },
    enabled: Boolean(params.start && params.end),
  });
}
