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
import { getOperationalProducts } from '@/lib/operationalProducts';
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
  is_sellable?: boolean;
  // Champs additifs : les anciens snapshots hors ligne restent lisibles.
  track_inventory?: boolean;
  display_stock?: { quantity: number | null } | null;
}

interface DisplayStock { quantity: number | null }
export function normalizeVariantStock<T extends { display_stock?: DisplayStock | DisplayStock[] | null }>(row: T):
  Omit<T, 'display_stock'> & { display_stock: DisplayStock | null } {
  const { display_stock, ...rest } = row;
  return { ...rest, display_stock: Array.isArray(display_stock) ? display_stock[0] ?? null : display_stock ?? null };
}


export function productVariantsOptions(parentId: string | null | undefined) {
  return queryOptions({
    queryKey: ['pos-product-variants', parentId],
    enabled: !!parentId,
    queryFn: async (): Promise<POSVariantRow[]> => {
      return (await getOperationalProducts()).filter((p) => p.parent_product_id === parentId && p.is_active && p.visible_on_pos)
        .sort((a, b) => a.variant_sort_order - b.variant_sort_order) as POSVariantRow[];
    },
  });
}

export function useProductVariants(parentId: string | null | undefined) {
  const enabled = useSaleQueryEnabled(!!parentId);
  return useQuery({ ...productVariantsOptions(parentId), enabled });
}
