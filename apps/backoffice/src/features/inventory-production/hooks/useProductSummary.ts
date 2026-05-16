// apps/backoffice/src/features/inventory-production/hooks/useProductSummary.ts
//
// Session 15 / Phase 3.B — RecipeCostPreviewCard support hook.
//
// Fetches the minimal product summary needed by the preview card
// (sku, name, image_url, unit, retail_price, cost_price). Cached for
// 60s — selling price / image rarely change inside an editor session.

import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/lib/supabase.js';

export interface ProductSummary {
  id:           string;
  sku:          string;
  name:         string;
  unit:         string;
  image_url:    string | null;
  retail_price: number | null;
  cost_price:   number;
}

export function useProductSummary(productId: string | null) {
  return useQuery<ProductSummary | null>({
    queryKey: ['inventory-production', 'product-summary', productId ?? ''] as const,
    enabled: productId !== null && productId !== '',
    staleTime: 60_000,
    queryFn: async () => {
      if (productId === null) return null;
      const { data, error } = await supabase
        .from('products')
        .select('id, sku, name, unit, image_url, retail_price, cost_price')
        .eq('id', productId)
        .maybeSingle();
      if (error) throw new Error(error.message);
      if (data === null) return null;
      return {
        id:           data.id,
        sku:          data.sku,
        name:         data.name,
        unit:         data.unit,
        image_url:    data.image_url ?? null,
        retail_price: data.retail_price === null ? null : Number(data.retail_price),
        cost_price:   Number(data.cost_price),
      };
    },
  });
}
