import { useQuery } from '@tanstack/react-query';
import { getOperationalProducts } from '@/lib/operationalProducts.js';

export interface DisplayStockRow {
  product_id: string;
  product_name: string;
  sku: string;
  unit: string;
  quantity: number | null;
}
export const DISPLAY_STOCK_QUERY_KEY = ['display-stock'] as const;
export function useDisplayStock() {
  return useQuery<DisplayStockRow[]>({
    queryKey: DISPLAY_STOCK_QUERY_KEY,
    staleTime: 15_000,
    queryFn: async () => (await getOperationalProducts())
      .filter((p) => p.is_display_item)
      .sort((a, b) => a.name.localeCompare(b.name))
      .map((p) => ({ product_id: p.id, product_name: p.name, sku: p.sku, unit: p.unit,
        quantity: p.display_stock?.quantity ?? null })),
  });
}
