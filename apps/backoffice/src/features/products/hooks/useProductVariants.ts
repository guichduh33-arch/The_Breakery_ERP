// apps/backoffice/src/features/products/hooks/useProductVariants.ts
//
// Session 27c — Lists variants of a parent product, ordered by variant_sort_order.
//
// Reads the child rows where `parent_product_id = parentId`, skipping soft-deleted
// products. Sorted ascending by `variant_sort_order` so DnD reorder via
// `reorder_variants_v1` is consistent with what the UI displays.

import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/lib/supabase.js';

export interface VariantRow {
  id:                 string;
  name:               string;
  sku:                string;
  retail_price:       number;
  cost_price:         number;
  variant_label:      string;
  variant_axis:       'flavor' | 'size' | 'format';
  variant_sort_order: number;
  is_active:          boolean;
  current_stock:      number | null;
  unit:               string;
}

interface VariantRowDb {
  id:                 string;
  name:               string;
  sku:                string;
  retail_price:       number;
  cost_price:         number;
  variant_label:      string | null;
  variant_axis:       string | null;
  variant_sort_order: number;
  is_active:          boolean;
  current_stock:      number | null;
  unit:               string;
}

export function useProductVariants(parentId: string | null | undefined) {
  return useQuery<VariantRow[]>({
    queryKey: ['product-variants', parentId ?? ''] as const,
    enabled: parentId !== null && parentId !== undefined && parentId !== '',
    staleTime: 30_000,
    queryFn: async () => {
      if (parentId === null || parentId === undefined || parentId === '') return [];
      const { data, error } = await supabase
        .from('products')
        .select(
          'id, name, sku, retail_price, cost_price, variant_label, variant_axis, variant_sort_order, is_active, current_stock, unit',
        )
        .eq('parent_product_id', parentId)
        .is('deleted_at', null)
        .order('variant_sort_order', { ascending: true });

      if (error !== null) throw error;

      const rows = (data ?? []) as VariantRowDb[];
      return rows.map((r) => ({
        id:                 r.id,
        name:               r.name,
        sku:                r.sku,
        retail_price:       Number(r.retail_price),
        cost_price:         Number(r.cost_price),
        variant_label:      r.variant_label ?? '',
        variant_axis:       (r.variant_axis === 'size' || r.variant_axis === 'format' ? r.variant_axis : 'flavor') as VariantRow['variant_axis'],
        variant_sort_order: Number(r.variant_sort_order),
        is_active:          r.is_active,
        current_stock:      r.current_stock === null ? null : Number(r.current_stock),
        unit:               r.unit,
      } satisfies VariantRow));
    },
  });
}
