// apps/backoffice/src/features/products/hooks/useRecipeBomFull.ts
//
// Session 39 — Wave B2 — Wraps recipe_bom_full_v1 (S17).
// Gate: inventory.read (SECURITY DEFINER).
// Returns 0 rows when the product has no recipe (purchase-driven WAC).

import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/lib/supabase.js';

export interface BomLine {
  material_id:   string;
  material_name: string;
  material_unit: string;
  recipe_unit:   string;
  qty_per_unit:  number;
  current_stock: number;
  cost_price:    number;
}

export function useRecipeBomFull(productId: string) {
  return useQuery<BomLine[]>({
    queryKey: ['recipe-bom-full', productId] as const,
    enabled:  productId !== '',
    staleTime: 30_000,
    queryFn: async () => {
      const { data, error } = await supabase.rpc('recipe_bom_full_v1', {
        p_product_id: productId,
      });
      if (error) throw error;
      return (data ?? []) as BomLine[];
    },
  });
}
