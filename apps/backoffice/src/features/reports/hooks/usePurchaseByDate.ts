// apps/backoffice/src/features/reports/hooks/usePurchaseByDate.ts
// S40 Wave B2 — Query hook for get_purchase_by_date_v1 RPC.

import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/lib/supabase.js';

export interface PurchaseByDayRow {
  date:           string;
  po_count:       number;
  total:          number;
  received_total: number;
  pending_total:  number;
}

export interface PurchaseByDateData {
  period:  { start: string; end: string };
  summary: {
    po_count:       number;
    total:          number;
    received_count: number;
    pending_count:  number;
  };
  by_day: PurchaseByDayRow[];
}

export interface UsePurchaseByDateParams {
  start: string;
  end:   string;
}

export function usePurchaseByDate(params: UsePurchaseByDateParams) {
  return useQuery<PurchaseByDateData, Error>({
    queryKey: ['reports', 'purchase-by-date', params.start, params.end],
    queryFn:  async () => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const { data, error } = await (supabase as any).rpc('get_purchase_by_date_v1', {
        p_date_start: params.start,
        p_date_end:   params.end,
      });
      if (error) throw error as Error;
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const raw = (data ?? {}) as any;
      return {
        period:  raw.period ?? { start: params.start, end: params.end },
        summary: {
          po_count:       Number(raw.summary?.po_count       ?? 0),
          total:          Number(raw.summary?.total          ?? 0),
          received_count: Number(raw.summary?.received_count ?? 0),
          pending_count:  Number(raw.summary?.pending_count  ?? 0),
        },
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        by_day: ((raw.by_day ?? []) as any[]).map((d) => ({
          date:           String(d.date).slice(0, 10),
          po_count:       Number(d.po_count),
          total:          Number(d.total),
          received_total: Number(d.received_total),
          pending_total:  Number(d.pending_total),
        })) as PurchaseByDayRow[],
      } satisfies PurchaseByDateData;
    },
    enabled: Boolean(params.start && params.end),
  });
}
