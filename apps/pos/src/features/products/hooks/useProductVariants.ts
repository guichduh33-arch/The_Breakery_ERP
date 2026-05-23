// apps/pos/src/features/products/hooks/useProductVariants.ts
// Session 27c — POS mirror of BO useProductVariants (read-only, is_active filter).
//
// Returns the active variants of a parent product, ordered by variant_sort_order.
// Used by VariantSelectModal to render the variant grid when a cashier taps a
// parent product.

import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/lib/supabase';

export interface POSVariantRow {
  id: string;
  name: string;
  retail_price: number;
  variant_label: string;
  variant_axis: 'flavor' | 'size' | 'format';
  variant_sort_order: number;
  is_active: boolean;
  current_stock: number | null;
  deduct_stock: boolean;
}

export function useProductVariants(parentId: string | null | undefined) {
  return useQuery({
    queryKey: ['pos-product-variants', parentId],
    enabled: !!parentId,
    queryFn: async (): Promise<POSVariantRow[]> => {
      const { data, error } = await supabase
        .from('products')
        .select(
          'id, name, retail_price, variant_label, variant_axis, variant_sort_order, is_active, current_stock, deduct_stock',
        )
        .eq('parent_product_id', parentId!)
        .eq('is_active', true)
        .is('deleted_at', null)
        .order('variant_sort_order', { ascending: true });

      if (error) throw error;
      return (data ?? []) as POSVariantRow[];
    },
  });
}
