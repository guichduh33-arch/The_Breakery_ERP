// apps/pos/src/features/products/hooks/useProductVariants.ts
// Session 27c — POS mirror of BO useProductVariants (read-only, is_active filter).
//
// Returns the active variants of a parent product, ordered by variant_sort_order.
// Used by VariantSelectModal to render the variant grid when a cashier taps a
// parent product.
//
// Session 59 (05 D1.1 review finding) — also filter `visible_on_pos = true`.
// A variant hidden from the counter in BO must not remain tappable inside
// the VariantSelectModal, mirroring the parent-grid filter in useProducts.ts.

import { queryOptions, useQuery } from '@tanstack/react-query';
import { supabase } from '@/lib/supabase';
import { useSaleQueryEnabled } from '@/features/lan/hooks/useSaleQueryEnabled';

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
  // Champs additifs : les anciens snapshots hors ligne restent lisibles.
  track_inventory?: boolean;
  display_stock?: { quantity: number } | null;
}

interface DisplayStock { quantity: number }
export function normalizeVariantStock<T extends { display_stock?: DisplayStock | DisplayStock[] | null }>(row: T):
  Omit<T, 'display_stock'> & { display_stock: DisplayStock | null } {
  const { display_stock, ...rest } = row;
  return { ...rest, display_stock: Array.isArray(display_stock) ? display_stock[0] ?? null : display_stock ?? null };
}

type RawVariant = Omit<POSVariantRow, 'display_stock'> & { display_stock?: DisplayStock | DisplayStock[] | null };

export function productVariantsOptions(parentId: string | null | undefined) {
  return queryOptions({
    queryKey: ['pos-product-variants', parentId],
    enabled: !!parentId,
    queryFn: async (): Promise<POSVariantRow[]> => {
      const { data, error } = await supabase
        .from('products')
        .select(
          'id, name, retail_price, variant_label, variant_axis, variant_sort_order, is_active, current_stock, deduct_stock, track_inventory, display_stock(quantity)',
        )
        .eq('parent_product_id', parentId!)
        .eq('is_active', true)
        .eq('visible_on_pos', true)
        .is('deleted_at', null)
        .order('variant_sort_order', { ascending: true });

      if (error) throw error;
      return ((data ?? []) as unknown as RawVariant[]).map(normalizeVariantStock);
    },
  });
}

export function useProductVariants(parentId: string | null | undefined) {
  const enabled = useSaleQueryEnabled(!!parentId);
  return useQuery({ ...productVariantsOptions(parentId), enabled });
}
