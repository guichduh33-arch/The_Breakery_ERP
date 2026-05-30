// apps/pos/src/features/stock/hooks/usePOSStockProducts.ts
//
// Session 14 — Phase 2.D — Fetches all active products for the POS-side
// "Cafe Stock" view (refs 70-72), grouped by category.
//
// POS display-stock isolation: this view now reflects the *vitrine* counter.
// Only products flagged `is_display_item` are listed, and the stock number is
// the one-to-one `display_stock.quantity` (NOT the BO `products.current_stock`).
//
// Pure read — for mutations see usePOSReceiveStock / closure hooks.

import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/lib/supabase';

export interface POSStockProductRow {
  id: string;
  sku: string;
  name: string;
  unit: string;
  image_url: string | null;
  display_stock: number;
  min_stock_threshold: number;
  retail_price: number;
  category_id: string;
  category_name: string;
  category_slug: string;
}

interface RawRow {
  id: string;
  sku: string;
  name: string;
  unit: string;
  image_url: string | null;
  min_stock_threshold: number;
  retail_price: number;
  category_id: string;
  // display_stock is one-to-one with products → PostgREST returns an object
  // (or null). Defensive: tolerate the array shape too.
  display_stock: { quantity: number } | { quantity: number }[] | null;
  category: { id: string; name: string; slug: string } | null;
}

export const POS_STOCK_PRODUCTS_KEY = ['pos-stock-products'];

export function usePOSStockProducts() {
  return useQuery<POSStockProductRow[]>({
    queryKey: POS_STOCK_PRODUCTS_KEY,
    queryFn: async () => {
      const { data, error } = await supabase
        .from('products')
        .select(
          'id, sku, name, unit, image_url, min_stock_threshold, retail_price, category_id, display_stock(quantity), category:categories(id, name, slug)',
        )
        .eq('is_active', true)
        .eq('is_display_item', true)
        .is('deleted_at', null)
        .order('name');

      if (error) throw new Error(error.message);
      const rows = (data ?? []) as unknown as RawRow[];
      return rows.map((r) => {
        const ds = r.display_stock;
        const qty = Array.isArray(ds) ? ds[0]?.quantity : ds?.quantity;
        return {
          id: r.id,
          sku: r.sku,
          name: r.name,
          unit: r.unit,
          image_url: r.image_url,
          display_stock: Number(qty ?? 0),
          min_stock_threshold: Number(r.min_stock_threshold),
          retail_price: Number(r.retail_price),
          category_id: r.category_id,
          category_name: r.category?.name ?? 'Uncategorized',
          category_slug: r.category?.slug ?? 'uncategorized',
        };
      });
    },
    staleTime: 15_000,
  });
}
