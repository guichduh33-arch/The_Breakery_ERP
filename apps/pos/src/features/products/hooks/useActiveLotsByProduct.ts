// apps/pos/src/features/products/hooks/useActiveLotsByProduct.ts
//
// Session 13 — F1 expiry tracking. Fetches ALL active stock_lots and groups
// them by product_id so ProductGrid can derive "all lots dead" per product
// without an N+1 query.
//
// Direct SELECT on stock_lots is fine — RLS gates by inventory.read which
// every authenticated POS cashier has.

import { useQuery } from '@tanstack/react-query';
import type { StockLotForFifo } from '@breakery/domain';
import { supabase } from '@/lib/supabase';

export const ACTIVE_LOTS_QUERY_KEY = ['active-lots-by-product'] as const;

/**
 * Returns a Map<product_id, StockLotForFifo[]> of all currently-active lots.
 *
 * Refetches every 60s to keep the POS grid in sync with the hourly expiry
 * cron — a lot crossing the boundary will surface as 'expired' within a
 * minute of the cron flip.
 */
export function useActiveLotsByProduct() {
  return useQuery<Map<string, StockLotForFifo[]>>({
    queryKey: ACTIVE_LOTS_QUERY_KEY,
    staleTime: 30_000,
    refetchInterval: 60_000,
    queryFn: async () => {
      const { data, error } = await supabase
        // eslint-disable-next-line @typescript-eslint/no-explicit-any -- types regenerate after migration apply
        .from('stock_lots' as any)
        .select('id, product_id, quantity, expires_at, received_at, status')
        .eq('status', 'active');
      if (error) throw error;

      const map = new Map<string, StockLotForFifo[]>();
      for (const r of (data ?? []) as unknown as StockLotForFifo[]) {
        const arr = map.get(r.product_id);
        if (arr === undefined) {
          map.set(r.product_id, [r]);
        } else {
          arr.push(r);
        }
      }
      return map;
    },
  });
}
