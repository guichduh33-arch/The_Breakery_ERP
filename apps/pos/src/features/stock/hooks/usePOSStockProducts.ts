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
import { getOperationalProducts } from '@/lib/operationalProducts';

export interface POSStockProductRow {
  id: string;
  sku: string;
  name: string;
  unit: string;
  image_url: string | null;
  display_stock: number | null;
  is_sellable?: boolean;
  min_stock_threshold: number;
  retail_price: number;
  category_id: string;
  category_name: string;
  category_slug: string;
}

export const POS_STOCK_PRODUCTS_KEY = ['pos-stock-products'];

export function usePOSStockProducts() {
  return useQuery<POSStockProductRow[]>({
    queryKey: POS_STOCK_PRODUCTS_KEY,
    queryFn: async () => {
      const rows = (await getOperationalProducts()).filter((p) => p.is_active && p.is_display_item).sort((a,b) => a.name.localeCompare(b.name));
      return rows.map((r) => {
        const ds = r.display_stock;
        const qty = ds?.quantity;
        return {
          id: r.id,
          sku: r.sku,
          name: r.name,
          unit: r.unit,
          image_url: r.image_url,
          display_stock: qty ?? null,
          is_sellable: r.is_sellable,
          min_stock_threshold: Number(r.min_stock_threshold),
          retail_price: Number(r.retail_price),
          category_id: r.category_id ?? '',
          category_name: r.categories?.name ?? 'Uncategorized',
          category_slug: r.categories?.slug ?? 'uncategorized',
        };
      });
    },
    staleTime: 15_000,
  });
}
