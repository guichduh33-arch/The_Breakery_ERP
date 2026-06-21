// apps/backoffice/src/features/products/hooks/useProducts.ts
//
// Session 14 / Phase 4.B — Catalog list query.
// Joins `categories.name` so the table can render the category column without
// a second round-trip. Sorts by name. Read-only — write paths arrive when the
// product CRUD RPCs land in a future session.

import { useQuery } from '@tanstack/react-query';
import type { AllergenType } from '@breakery/ui';
import { supabase } from '@/lib/supabase.js';
import type { ProductRow } from '../types.js';

interface ProductRowDb {
  id:               string;
  sku:              string;
  name:             string;
  category_id:      string;
  retail_price:     number;
  wholesale_price:  number | null;
  cost_price:       number;
  product_type:     string;
  tax_inclusive:    boolean;
  image_url:        string | null;
  current_stock:    number;
  min_stock_threshold: number;
  unit:             string;
  is_active:        boolean;
  is_favorite:      boolean;
  allergens:        AllergenType[] | null;
  description:                string | null;
  visible_on_pos:             boolean;
  available_for_sale:         boolean;
  track_inventory:            boolean;
  deduct_stock:               boolean;
  is_semi_finished:           boolean;
  target_gross_margin_pct:    number | null;
  default_shelf_life_hours:   number | null;
  is_display_item:            boolean;
  // Session 27c — variant grouping
  parent_product_id:          string | null;
  variant_label:              string | null;
  variant_axis:               string | null;
  variant_sort_order:         number;
  categories:       { name: string; category_type: string | null } | { name: string; category_type: string | null }[] | null;
}

export function useProducts() {
  return useQuery<ProductRow[]>({
    queryKey: ['products', 'catalog'] as const,
    staleTime: 30_000,
    queryFn: async () => {
      const { data, error } = await supabase
        .from('products')
        .select(`
          id, sku, name, category_id,
          retail_price, wholesale_price, cost_price,
          product_type, tax_inclusive, image_url,
          current_stock, min_stock_threshold, unit,
          is_active, is_favorite, allergens,
          description, visible_on_pos, available_for_sale,
          track_inventory, deduct_stock, is_semi_finished,
          target_gross_margin_pct, default_shelf_life_hours, is_display_item,
          parent_product_id, variant_label, variant_axis, variant_sort_order,
          categories:categories ( name, category_type )
        `)
        .is('deleted_at', null)
        .order('name');
      if (error) throw error;

      const rows = (data ?? []) as ProductRowDb[];
      return rows.map((r) => {
        const category = Array.isArray(r.categories) ? r.categories[0] ?? null : r.categories;
        const categoryName = category?.name ?? null;
        const categoryType = category?.category_type ?? null;
        return {
          id:                  r.id,
          sku:                 r.sku,
          name:                r.name,
          category_id:         r.category_id,
          retail_price:        Number(r.retail_price),
          wholesale_price:     r.wholesale_price === null ? null : Number(r.wholesale_price),
          cost_price:          Number(r.cost_price),
          product_type:        (r.product_type === 'combo' ? 'combo' : 'finished') as ProductRow['product_type'],
          tax_inclusive:       r.tax_inclusive,
          image_url:           r.image_url,
          current_stock:       Number(r.current_stock),
          min_stock_threshold: Number(r.min_stock_threshold),
          unit:                r.unit,
          is_active:           r.is_active,
          is_favorite:         r.is_favorite,
          allergens:           r.allergens ?? [],
          description:               r.description,
          visible_on_pos:            r.visible_on_pos,
          available_for_sale:        r.available_for_sale,
          track_inventory:           r.track_inventory,
          deduct_stock:              r.deduct_stock,
          is_semi_finished:          r.is_semi_finished,
          target_gross_margin_pct:   r.target_gross_margin_pct === null ? null : Number(r.target_gross_margin_pct),
          default_shelf_life_hours:  r.default_shelf_life_hours,
          is_display_item:           r.is_display_item ?? false,
          parent_product_id:         r.parent_product_id,
          variant_label:             r.variant_label,
          variant_axis:              r.variant_axis,
          variant_sort_order:        Number(r.variant_sort_order),
          category_name:             categoryName,
          category_type:             categoryType,
        } satisfies ProductRow;
      });
    },
  });
}
