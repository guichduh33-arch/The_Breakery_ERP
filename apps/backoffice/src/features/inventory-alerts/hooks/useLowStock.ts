// apps/backoffice/src/features/inventory-alerts/hooks/useLowStock.ts
// Session 13 / Phase 2.D — get_low_stock wrapper.
//
// ADR-027 — bump v1 → v2 : la RPC ne garde que le mode global, sans argument.
// Le seuil se compare à `products.current_stock`, l'unique stock.

import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/lib/supabase.js';

export interface LowStockRow {
  product_id:          string;
  product_sku:         string;
  product_name:        string;
  current_qty:         number;
  min_stock_threshold: number;
  unit:                string;
  shortfall:           number;
}

type RpcFn = (
  fn: string, args?: Record<string, unknown>
) => Promise<{ data: LowStockRow[] | null; error: { message: string } | null }>;

function rpc(): RpcFn {
  return supabase.rpc.bind(supabase) as unknown as RpcFn;
}

export const LOW_STOCK_KEY = ['low-stock-v2'] as const;

export function useLowStock() {
  return useQuery<LowStockRow[]>({
    queryKey: LOW_STOCK_KEY,
    staleTime: 60_000,
    queryFn: async () => {
      const { data, error } = await rpc()('get_low_stock_v2');
      if (error !== null) throw new Error(error.message);
      return data ?? [];
    },
  });
}
