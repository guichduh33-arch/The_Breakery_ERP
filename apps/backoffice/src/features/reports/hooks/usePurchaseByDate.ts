// apps/backoffice/src/features/reports/hooks/usePurchaseByDate.ts
// S40 Wave B2 — Query hook for get_purchase_by_date_v1 RPC.

import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/lib/supabase.js';
import { asArray, asRecord, toNum, toStr } from '../utils/parse.js';

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
      const { data, error } = await supabase.rpc('get_purchase_by_date_v1', {
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
          po_count:       toNum(summary.po_count),
          total:          toNum(summary.total),
          received_count: toNum(summary.received_count),
          pending_count:  toNum(summary.pending_count),
        },
        by_day: asArray(raw.by_day).map((d): PurchaseByDayRow => {
          const o = asRecord(d);
          return {
            date:           toStr(o.date).slice(0, 10),
            po_count:       toNum(o.po_count),
            total:          toNum(o.total),
            received_total: toNum(o.received_total),
            pending_total:  toNum(o.pending_total),
          };
        }),
      } satisfies PurchaseByDateData;
    },
    enabled: Boolean(params.start && params.end),
  });
}
