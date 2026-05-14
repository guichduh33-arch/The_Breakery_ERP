// apps/backoffice/src/features/purchasing/hooks/useAllProductsForPO.ts
//
// Session 13 — Phase 3.A — list of active products used by the PO line-item
// editor. Limited to 500 (covers all bakery SKUs).

import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/lib/supabase.js';

export interface PoProductRow {
  id:         string;
  sku:        string;
  name:       string;
  unit:       string;
  cost_price: number | null;
}

export const PO_PRODUCTS_QUERY_KEY = ['po-products'] as const;

export function useAllProductsForPO() {
  return useQuery<PoProductRow[]>({
    queryKey: PO_PRODUCTS_QUERY_KEY,
    staleTime: 60_000,
    queryFn: async () => {
      const { data, error } = await supabase
        .from('products')
        .select('id, sku, name, unit, cost_price')
        .is('deleted_at', null)
        .eq('is_active', true)
        .order('name')
        .limit(500);
      if (error) throw error;
      return (data ?? []) as PoProductRow[];
    },
  });
}
