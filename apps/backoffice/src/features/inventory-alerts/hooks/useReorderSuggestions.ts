// apps/backoffice/src/features/inventory-alerts/hooks/useReorderSuggestions.ts
// Session 13 / Phase 2.D — get_reorder_suggestions_v1 wrapper.

import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/lib/supabase.js';

export interface ReorderSuggestion {
  product_id:          string;
  product_sku:         string;
  product_name:        string;
  unit:                string;
  current_stock:       number;
  min_stock_threshold: number;
  avg_daily_usage:     number;
  days_of_stock:       number | null;
  suggested_order_qty: number;
  supplier_id:         string | null;
  supplier_name:       string | null;
  last_purchase_at:    string | null;
}

type RpcFn = (
  fn: string, args?: Record<string, unknown>
) => Promise<{ data: ReorderSuggestion[] | null; error: { message: string } | null }>;

function rpc(): RpcFn {
  return supabase.rpc as unknown as RpcFn;
}

export const REORDER_SUGGESTIONS_KEY = ['reorder-suggestions-v1'] as const;

export function useReorderSuggestions(lookbackDays = 30, bufferDays = 14) {
  return useQuery<ReorderSuggestion[]>({
    queryKey: [...REORDER_SUGGESTIONS_KEY, lookbackDays, bufferDays] as const,
    staleTime: 60_000,
    queryFn: async () => {
      const { data, error } = await rpc()('get_reorder_suggestions_v1', {
        p_lookback_days: lookbackDays,
        p_buffer_days: bufferDays,
      });
      if (error !== null) throw new Error(error.message);
      return data ?? [];
    },
  });
}
