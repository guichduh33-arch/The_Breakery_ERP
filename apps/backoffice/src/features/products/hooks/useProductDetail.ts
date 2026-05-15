// apps/backoffice/src/features/products/hooks/useProductDetail.ts
//
// Session 14 / Phase 4.B — Single product fetch for the detail page.

import { useQuery } from '@tanstack/react-query';
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
  categories:       { name: string } | { name: string }[] | null;
}

export function useProductDetail(productId: string | null) {
  return useQuery<ProductRow | null>({
    queryKey: ['products', 'detail', productId ?? ''] as const,
    enabled: productId !== null && productId !== '',
    staleTime: 30_000,
    queryFn: async () => {
      if (productId === null || productId === '') return null;
      const { data, error } = await supabase
        .from('products')
        .select(`
          id, sku, name, category_id,
          retail_price, wholesale_price, cost_price,
          product_type, tax_inclusive, image_url,
          current_stock, min_stock_threshold, unit,
          is_active, is_favorite,
          categories:categories ( name )
        `)
        .eq('id', productId)
        .is('deleted_at', null)
        .maybeSingle();
      if (error) throw error;
      if (data === null) return null;
      const r = data as ProductRowDb;
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
        category_name:       categoryName,
      } satisfies ProductRow;
    },
  });
}
