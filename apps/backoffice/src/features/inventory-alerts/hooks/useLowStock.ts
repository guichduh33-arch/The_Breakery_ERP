// apps/backoffice/src/features/inventory-alerts/hooks/useLowStock.ts
// Session 13 / Phase 2.D — get_low_stock_v1 wrapper.

import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/lib/supabase.js';

export interface LowStockRow {
  product_id:          string;
  product_sku:         string;
  product_name:        string;
  current_qty:         number;
  min_stock_threshold: number;
  unit:                string;
  section_id:          string | null;
  section_code:        string | null;
  section_name:        string | null;
  shortfall:           number;
}

type RpcFn = (
  fn: string, args?: Record<string, unknown>
) => Promise<{ data: LowStockRow[] | null; error: { message: string } | null }>;

function rpc(): RpcFn {
  return supabase.rpc as unknown as RpcFn;
}

export const LOW_STOCK_KEY = ['low-stock-v1'] as const;

export function useLowStock(sectionId: string | null = null) {
  return useQuery<LowStockRow[]>({
    queryKey: [...LOW_STOCK_KEY, sectionId ?? 'all'] as const,
    staleTime: 60_000,
    queryFn: async () => {
      const args: Record<string, unknown> = {};
      if (sectionId !== null) args.p_section_id = sectionId;
      const { data, error } = await rpc()('get_low_stock_v1', args);
      if (error !== null) throw new Error(error.message);
      return data ?? [];
    },
  });
}
