// apps/backoffice/src/features/orders/hooks/useProductsForOrderEdit.ts
// Session 39 / Wave C1 — sellable products for BO order editing.
//
// Parent exclusion: any product referenced as parent_product_id by another
// active row in the list is a parent → excluded (same rule as POS S27c).
// Accepted edge: a parent whose variants are ALL inactive stays listed.

import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/lib/supabase.js';

export interface OrderEditProduct {
  id:            string;
  sku:           string;
  name:          string;
  retail_price:  number;
  variant_label: string | null;
}

export function useProductsForOrderEdit() {
  return useQuery<OrderEditProduct[], Error>({
    queryKey: ['products-for-order-edit'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('products')
        .select('id, sku, name, retail_price, variant_label, parent_product_id')
        .eq('is_active', true)
        .eq('available_for_sale', true)
        .order('name');
      if (error) throw error;
      const rows = (data ?? []) as Array<{
        id: string;
        sku: string;
        name: string;
        retail_price: number;
        variant_label: string | null;
        parent_product_id: string | null;
      }>;
      const parentIds = new Set(rows.map((r) => r.parent_product_id).filter(Boolean));
      return rows
        .filter((r) => !parentIds.has(r.id))
        .map(({ id, sku, name, retail_price, variant_label }) => ({
          id,
          sku,
          name,
          retail_price,
          variant_label,
        }));
    },
    staleTime: 60_000,
  });
}
