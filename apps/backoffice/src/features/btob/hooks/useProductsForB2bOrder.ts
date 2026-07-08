// apps/backoffice/src/features/btob/hooks/useProductsForB2bOrder.ts
//
// Session 24 / Phase 2.A.3 — minimal active-products list for the B2B order
// items picker. Returns id + name + price + current_stock so the modal can
// default unit_price and gate against insufficient_stock client-side before
// the RPC complains.

import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/lib/supabase.js';

export interface B2bOrderProductOption {
  id:            string;
  sku:           string;
  name:          string;
  price:         number;
  current_stock: number;
  unit:          string | null;
}

export const B2B_ORDER_PRODUCTS_QUERY_KEY = ['b2b-order-products'] as const;

export function useProductsForB2bOrder() {
  return useQuery<B2bOrderProductOption[]>({
    queryKey: B2B_ORDER_PRODUCTS_QUERY_KEY,
    staleTime: 60_000,
    queryFn: async () => {
      const { data, error } = await supabase
        .from('products')
        // `price` is an alias of the real column retail_price (products has no `price`
        // column) — used only as the client-side prefill fallback; the server (v5) is
        // authoritative and resolves negotiated > category > retail regardless.
        .select('id, sku, name, price:retail_price, current_stock, unit')
        .is('deleted_at', null)
        .eq('is_active', true)
        .order('name', { ascending: true })
        .limit(500);
      if (error) throw error;
      return data ?? [];
    },
  });
}
