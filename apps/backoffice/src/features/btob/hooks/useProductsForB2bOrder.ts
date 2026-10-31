// apps/backoffice/src/features/btob/hooks/useProductsForB2bOrder.ts
//
// Session 24 / Phase 2.A.3 — minimal active-products list for the B2B order
// items picker. Returns id + name + price + current_stock so the modal can
// default unit_price and gate against insufficient_stock client-side before
// the RPC complains.

import { useQuery } from '@tanstack/react-query';
import { getOperationalProducts } from '@/lib/operationalProducts.js';

export interface B2bOrderProductOption {
  id:            string;
  sku:           string;
  name:          string;
  price:         number;
  current_stock: number | null;
  track_inventory: boolean;
  unit:          string | null;
}

export const B2B_ORDER_PRODUCTS_QUERY_KEY = ['b2b-order-products'] as const;

export function useProductsForB2bOrder() {
  return useQuery<B2bOrderProductOption[]>({
    queryKey: B2B_ORDER_PRODUCTS_QUERY_KEY,
    staleTime: 60_000,
    queryFn: async () => {
      return (await getOperationalProducts())
        .filter((p) => p.is_active && p.deleted_at === null)
        .sort((a, b) => a.name.localeCompare(b.name)).slice(0, 500)
        .map((p) => ({ id: p.id, sku: p.sku, name: p.name, price: p.retail_price,
          current_stock: p.current_stock, track_inventory: p.track_inventory, unit: p.unit }));
    },
  });
}
