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
  categories:       { name: string } | { name: string }[] | null;
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
          categories:categories ( name )
        `)
        .is('deleted_at', null)
        .order('name');
      if (error) throw error;

      const rows = (data ?? []) as ProductRowDb[];
      return rows.map((r) => {
        const categoryName = Array.isArray(r.categories)
          ? r.categories[0]?.name ?? null
          : r.categories?.name ?? null;
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
          category_name:       categoryName,
        } satisfies ProductRow;
      });
    },
  });
}
