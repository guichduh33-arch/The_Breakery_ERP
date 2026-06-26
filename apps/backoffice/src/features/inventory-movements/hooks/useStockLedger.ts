// apps/backoffice/src/features/inventory-movements/hooks/useStockLedger.ts
// 2026-06-18 — stock-card ledger feed for both BO stock-movement pages.
// Single (non-paginated) query over get_stock_movement_ledger_v1: the full filtered
// date range with a server-side running balance + cap. ref_no / type label are
// synthesized in the table via @breakery/domain.

import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/lib/supabase.js';

export interface StockLedgerLine {
  id:              string;
  movement_date:   string;        // 'YYYY-MM-DD'
  created_time:    string;        // ISO timestamptz
  movement_type:   string;
  product_id:      string;
  product_name:    string | null;
  product_group:   string | null;
  unit:            string | null;
  incoming_qty:    number;
  outgoing_qty:    number;
  beginning_qty:   number;
  balance_qty:     number;
  price:           number;
  movement_amount: number;
  reference_type:  string | null;
  reference_id:    string | null;
  reason:          string | null;
  reference_label: string | null; // human document no. (orders.order_number for sales)
  created_by_name: string | null;
}

export interface StockLedgerResult {
  lines:     StockLedgerLine[];
  truncated: boolean;
  row_count: number;
}

export interface UseStockLedgerParams {
  start:         string;
  end:           string;
  productId?:    string | undefined;
  movementType?: string | undefined;
  sectionId?:    string | undefined;
  limit?:        number | undefined;
}

export const STOCK_LEDGER_KEY = ['stock-ledger'] as const;

export function useStockLedger(params: UseStockLedgerParams) {
  return useQuery<StockLedgerResult, Error>({
    queryKey: [...STOCK_LEDGER_KEY, params] as const,
    queryFn: async () => {
      const { data, error } = await (supabase as unknown as {
        rpc: (fn: string, args: Record<string, unknown>) => Promise<{ data: unknown; error: { message: string } | null }>;
      }).rpc('get_stock_movement_ledger_v1', {
        p_start:         params.start,
        p_end:           params.end,
        p_product_id:    params.productId    ?? null,
        p_movement_type: params.movementType ?? null,
        p_section_id:    params.sectionId    ?? null,
        p_limit:         params.limit        ?? 5000,
      });
      if (error !== null) throw new Error(error.message);
      const r = (data ?? {}) as Partial<StockLedgerResult>;
      return {
        lines:     r.lines     ?? [],
        truncated: r.truncated ?? false,
        row_count: r.row_count ?? 0,
      };
    },
    enabled: Boolean(params.start && params.end),
  });
}
