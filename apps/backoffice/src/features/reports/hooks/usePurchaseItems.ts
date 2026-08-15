// apps/backoffice/src/features/reports/hooks/usePurchaseItems.ts
// S40 Wave B2 — Query hook for get_purchase_items_v1 RPC.

import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/lib/supabase.js';
import { asArray, asRecord, toNum, toStr } from '../utils/parse.js';

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
      // `exactOptionalPropertyTypes` : on omet la clé quand il n'y a pas de
      // filtre fournisseur — elle tombe sur le DEFAULT NULL de la RPC.
      const args: { p_date_start: string; p_date_end: string; p_supplier_id?: string } = {
        p_date_start: params.start,
        p_date_end:   params.end,
      };
      if (params.supplierId) args.p_supplier_id = params.supplierId;
      const { data, error } = await supabase.rpc('get_purchase_items_v1', args);
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
          line_count:  toNum(summary.line_count),
          total_value: toNum(summary.total_value),
        },
        lines: asArray(raw.lines).map((l): PurchaseItemLine => {
          const o = asRecord(l);
          return {
            po_id:             toStr(o.po_id),
            po_number:         toStr(o.po_number),
            order_date:        toStr(o.order_date),
            supplier_name:     toStr(o.supplier_name, '—'),
            product_id:        toStr(o.product_id),
            product_name:      toStr(o.product_name, '—'),
            sku:               toStr(o.sku),
            quantity:          toNum(o.quantity),
            received_quantity: toNum(o.received_quantity),
            unit_cost:         toNum(o.unit_cost),
            subtotal:          toNum(o.subtotal),
            status:            toStr(o.status),
          };
        }),
        truncated: raw.truncated === true,
      } satisfies PurchaseItemsData;
    },
    enabled: Boolean(params.start && params.end),
  });
}
