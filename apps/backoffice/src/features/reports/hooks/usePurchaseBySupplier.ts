// apps/backoffice/src/features/reports/hooks/usePurchaseBySupplier.ts
// S40 Wave B2 — Query hook for get_purchase_by_supplier_v1 RPC.

import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/lib/supabase.js';
import { asArray, asRecord, toNum, toStr } from '../utils/parse.js';

export interface PurchaseBySupplierRow {
  supplier_id:     string;
  supplier_name:   string;
  po_count:        number;
  total:           number;
  received_count:  number;
  cancelled_count: number;
  avg_lead_days:   number | null;
  share_pct:       number;
}

export interface PurchaseBySupplierData {
  period:      { start: string; end: string };
  by_supplier: PurchaseBySupplierRow[];
}

export interface UsePurchaseBySupplierParams {
  start: string;
  end:   string;
}

export function usePurchaseBySupplier(params: UsePurchaseBySupplierParams) {
  return useQuery<PurchaseBySupplierData, Error>({
    queryKey: ['reports', 'purchase-by-supplier', params.start, params.end],
    queryFn:  async () => {
      const { data, error } = await supabase.rpc('get_purchase_by_supplier_v1', {
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
        by_supplier: asArray(raw.by_supplier).map((s): PurchaseBySupplierRow => {
          const o = asRecord(s);
          return {
            supplier_id:     toStr(o.supplier_id),
            supplier_name:   toStr(o.supplier_name, '—'),
            po_count:        toNum(o.po_count),
            total:           toNum(o.total),
            received_count:  toNum(o.received_count),
            cancelled_count: toNum(o.cancelled_count),
            avg_lead_days:   o.avg_lead_days == null ? null : toNum(o.avg_lead_days),
            share_pct:       toNum(o.share_pct),
          };
        }),
      } satisfies PurchaseBySupplierData;
    },
    enabled: Boolean(params.start && params.end),
  });
}
