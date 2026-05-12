// apps/backoffice/src/features/inventory/hooks/useStockMovements.ts
//
// Paginated history of stock_movements for a single product. Joins the
// supplier row (code + name) so the drawer can label receipts. Sorted
// most-recent first. RLS authorises any user with `inventory.read`.

import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/lib/supabase.js';
import type { Database } from '@breakery/supabase';

type MovementType = Database['public']['Enums']['movement_type'];

export interface StockMovementRow {
  id:               string;
  product_id:       string;
  movement_type:    MovementType;
  quantity:         number;
  reason:           string | null;
  unit_cost:        number | null;
  supplier_id:      string | null;
  reference_type:   string;
  reference_id:     string | null;
  idempotency_key:  string | null;
  created_at:       string;
  created_by:       string;
  supplier:         { code: string; name: string } | null;
  author:           { id: string; full_name: string } | null;
}

export const PAGE_SIZE = 50;

export const stockMovementsKey = (productId: string, page: number) =>
  ['stock-movements', productId, page] as const;

export function useStockMovements(productId: string | null, page: number) {
  return useQuery<StockMovementRow[]>({
    queryKey: productId !== null
      ? stockMovementsKey(productId, page)
      : (['stock-movements', 'noop', page] as const),
    enabled:   productId !== null,
    staleTime: 30_000,
    queryFn: async () => {
      if (productId === null) return [];
      const from = page * PAGE_SIZE;
      const to   = from + PAGE_SIZE - 1;
      const { data, error } = await supabase
        .from('stock_movements')
        .select(`
          id, product_id, movement_type, quantity, reason, unit_cost,
          supplier_id, reference_type, reference_id, idempotency_key,
          created_at, created_by,
          supplier:suppliers(code, name),
          author:user_profiles!stock_movements_created_by_fkey(id, full_name)
        `)
        .eq('product_id', productId)
        .order('created_at', { ascending: false })
        .range(from, to);
      if (error) throw error;
      return data ?? [];
    },
  });
}
