// apps/pos/src/features/stock/hooks/usePOSStockProducts.ts
//
// Session 14 — Phase 2.D — Fetches all active products with current stock,
// grouped by category, for the POS-side "Cafe Stock" view (refs 70-72).
//
// Pure read — for mutations see usePOSReceiveStock / usePOSWasteStock.

import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/lib/supabase';

export interface POSStockProductRow {
  id: string;
  sku: string;
  name: string;
  unit: string;
  image_url: string | null;
  current_stock: number;
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
  current_stock: number;
  min_stock_threshold: number;
  retail_price: number;
  category_id: string;
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
          'id, sku, name, unit, image_url, current_stock, min_stock_threshold, retail_price, category_id, category:categories(id, name, slug)',
        )
        .eq('is_active', true)
        .is('deleted_at', null)
        .order('name');

      if (error) throw new Error(error.message);
      const rows = (data ?? []) as unknown as RawRow[];
      return rows.map((r) => ({
        id: r.id,
        sku: r.sku,
        name: r.name,
        unit: r.unit,
        image_url: r.image_url,
        current_stock: Number(r.current_stock),
        min_stock_threshold: Number(r.min_stock_threshold),
        retail_price: Number(r.retail_price),
        category_id: r.category_id,
        category_name: r.category?.name ?? 'Uncategorized',
        category_slug: r.category?.slug ?? 'uncategorized',
      }));
    },
    staleTime: 15_000,
  });
}
