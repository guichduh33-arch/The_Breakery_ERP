// apps/backoffice/src/features/reports/hooks/usePurchaseItems.ts
// S40 Wave B2 — Query hook for get_purchase_items_v1 RPC.

import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/lib/supabase.js';

export interface PurchaseItemLine {
  po_id:             string;
  po_number:         string;
  order_date:        string;
  supplier_name:     string;
  product_id:        string;
  product_name:      string;
  sku:               string;
  quantity:          number;
  received_quantity: number;
  unit_cost:         number;
  subtotal:          number;
  status:            string;
}

export interface PurchaseItemsData {
  period:    { start: string; end: string };
  summary:   { line_count: number; total_value: number };
  lines:     PurchaseItemLine[];
  truncated: boolean;
}

export interface UsePurchaseItemsParams {
  start:       string;
  end:         string;
  supplierId?: string | null;
}

export function usePurchaseItems(params: UsePurchaseItemsParams) {
  return useQuery<PurchaseItemsData, Error>({
    queryKey: ['reports', 'purchase-items', params.start, params.end, params.supplierId ?? null],
    queryFn:  async () => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const { data, error } = await (supabase as any).rpc('get_purchase_items_v1', {
        p_date_start:  params.start,
        p_date_end:    params.end,
        p_supplier_id: params.supplierId ?? null,
      });
      if (error) throw error as Error;
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const raw = (data ?? {}) as any;
      return {
        period:    raw.period   ?? { start: params.start, end: params.end },
        summary:   {
          line_count:  Number(raw.summary?.line_count  ?? 0),
          total_value: Number(raw.summary?.total_value ?? 0),
        },
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        lines:     ((raw.lines ?? []) as any[]).map((l) => ({
          po_id:             l.po_id             as string,
          po_number:         l.po_number         as string,
          order_date:        l.order_date        as string,
          supplier_name:     l.supplier_name     as string,
          product_id:        l.product_id        as string,
          product_name:      l.product_name      as string,
          sku:               l.sku               as string,
          quantity:          Number(l.quantity),
          received_quantity: Number(l.received_quantity),
          unit_cost:         Number(l.unit_cost),
          subtotal:          Number(l.subtotal),
          status:            l.status            as string,
        })) as PurchaseItemLine[],
        truncated: Boolean(raw.truncated),
      } satisfies PurchaseItemsData;
    },
    enabled: Boolean(params.start && params.end),
  });
}
