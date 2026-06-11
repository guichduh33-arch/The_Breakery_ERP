// apps/backoffice/src/features/reports/hooks/useDailySales.ts
// S40 Wave B1 — Query hook for get_daily_sales_v1 RPC.

import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/lib/supabase.js';

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
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const { data, error } = await (supabase as any).rpc('get_daily_sales_v1', {
        p_date_start: params.start,
        p_date_end:   params.end,
      });
      if (error) throw error as Error;
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const raw = (data ?? {}) as any;
      return {
        period:  raw.period  ?? { start: params.start, end: params.end },
        summary: raw.summary ?? { total: 0, order_count: 0, aov: 0, refund_total: 0, net: 0 },
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        by_day:  ((raw.by_day ?? []) as any[]).map((r) => ({
          date:        r.date,
          order_count: Number(r.order_count ?? 0),
          gross:       Number(r.gross       ?? 0),
          refunds:     Number(r.refunds     ?? 0),
          net:         Number(r.net         ?? 0),
          aov:         Number(r.aov         ?? 0),
        })) as DailySalesRow[],
      } satisfies DailySalesData;
    },
    enabled: Boolean(params.start && params.end),
  });
}
