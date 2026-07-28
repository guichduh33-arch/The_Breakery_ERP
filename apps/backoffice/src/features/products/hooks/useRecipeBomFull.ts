// apps/backoffice/src/features/products/hooks/useRecipeBomFull.ts
//
// Session 39 — Wave B2 — Wraps recipe_bom_full_v2.
// Gate: inventory.read (SECURITY DEFINER).
// Returns 0 rows when the product has no recipe (purchase-driven WAC).
//
// ADR-016 — un semi-fini suivi en stock est une ligne terminale, valorisée à
// son propre coût, et non plus décomposé en ses matières.

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
  // recipe qty converted into the material's stock unit (e.g. 284 gr → 0.284 kg)
  qty_in_base:   number;
  // dimensionally-correct line cost = qty_in_base × cost_price (computed server-side)
  line_cost:     number;
}

export function useRecipeBomFull(productId: string) {
  return useQuery<BomLine[]>({
    queryKey: ['recipe-bom-full', productId] as const,
    enabled:  productId !== '',
    staleTime: 30_000,
    queryFn: async () => {
      const { data, error } = await supabase.rpc('recipe_bom_full_v2', {
        p_product_id: productId,
      });
      if (error) throw error;
      return (data ?? []) as BomLine[];
    },
  });
}
