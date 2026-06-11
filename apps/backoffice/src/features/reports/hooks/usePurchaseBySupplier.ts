// apps/backoffice/src/features/reports/hooks/usePurchaseBySupplier.ts
// S40 Wave B2 — Query hook for get_purchase_by_supplier_v1 RPC.

import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/lib/supabase.js';

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
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const { data, error } = await (supabase as any).rpc('get_purchase_by_supplier_v1', {
        p_date_start: params.start,
        p_date_end:   params.end,
      });
      if (error) throw error as Error;
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const raw = (data ?? {}) as any;
      return {
        period: raw.period ?? { start: params.start, end: params.end },
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        by_supplier: ((raw.by_supplier ?? []) as any[]).map((s) => ({
          supplier_id:     s.supplier_id     as string,
          supplier_name:   s.supplier_name   as string,
          po_count:        Number(s.po_count),
          total:           Number(s.total),
          received_count:  Number(s.received_count),
          cancelled_count: Number(s.cancelled_count),
          avg_lead_days:   s.avg_lead_days != null ? Number(s.avg_lead_days) : null,
          share_pct:       Number(s.share_pct),
        })) as PurchaseBySupplierRow[],
      } satisfies PurchaseBySupplierData;
    },
    enabled: Boolean(params.start && params.end),
  });
}
