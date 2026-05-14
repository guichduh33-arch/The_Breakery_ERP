// apps/backoffice/src/features/inventory/hooks/useStockLots.ts
//
// Session 13 — F1 expiry tracking. Direct SELECT on `stock_lots` for a single
// product (or all products if productId is null). Used by :
//   - POS ProductGrid : derive "all lots dead" → grey out card.
//   - BO product drawer "Lots" tab.
//
// Direct SELECT is fine here because RLS on stock_lots gates by
// `inventory.read` permission — no RPC indirection needed for read.

import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/lib/supabase.js';
import type { StockLotForFifo } from '@breakery/domain';

export type StockLotStatus = StockLotForFifo['status'];

export interface StockLotRow {
  id:           string;
  product_id:   string;
  location_id:  string | null;
  quantity:     number;
  unit:         string;
  expires_at:   string;
  received_at:  string;
  batch_number: string | null;
  status:       StockLotStatus;
  created_at:   string;
}

export const STOCK_LOTS_QUERY_KEY = ['stock-lots'] as const;

/**
 * Fetch lots for a single product (or all when productId is null).
 *
 * `activeOnly=true` (default) filters server-side to `status='active'`. Pass
 * false to include expired/consumed (BO history view).
 */
export function useStockLots(
  productId: string | null,
  options: { activeOnly?: boolean } = {},
) {
  const activeOnly = options.activeOnly ?? true;

  return useQuery<StockLotRow[]>({
    queryKey: [...STOCK_LOTS_QUERY_KEY, { productId, activeOnly }] as const,
    enabled: productId !== null,
    staleTime: 30_000,
    queryFn: async () => {
      if (productId === null) return [];

      let q = supabase
        // eslint-disable-next-line @typescript-eslint/no-explicit-any -- types regenerate after migration apply
        .from('stock_lots' as any)
        .select(
          'id, product_id, location_id, quantity, unit, expires_at, received_at, batch_number, status, created_at',
        )
        .eq('product_id', productId);

      if (activeOnly) {
        q = q.eq('status', 'active');
      }

      const { data, error } = await q.order('expires_at', { ascending: true });
      if (error) throw error;
      return (data ?? []) as unknown as StockLotRow[];
    },
  });
}
