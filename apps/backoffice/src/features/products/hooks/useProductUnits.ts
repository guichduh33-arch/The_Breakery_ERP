// apps/backoffice/src/features/products/hooks/useProductUnits.ts
//
// Session 39 — Wave B1 — Reads product_unit_alternatives + product_unit_contexts
// from the S27 tables for the UnitsPanel write-mode.

import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/lib/supabase.js';

export interface ProductUnitAlt {
  code:           string;
  factor_to_base: number;
  tags:           string[];
  display_order:  number;
}

export interface ProductUnitContexts {
  stock_opname_unit: string;
  recipe_unit:       string;
  purchase_unit:     string;
  sales_unit:        string;
}

export interface ProductUnitsData {
  alternatives: ProductUnitAlt[];
  contexts:     ProductUnitContexts | null;
}

export function useProductUnits(productId: string) {
  return useQuery<ProductUnitsData>({
    queryKey: ['product-units', productId] as const,
    enabled: productId !== '',
    staleTime: 30_000,
    queryFn: async () => {
      const [alts, ctx] = await Promise.all([
        supabase
          .from('product_unit_alternatives')
          .select('code, factor_to_base, tags, display_order')
          .eq('product_id', productId)
          .is('deleted_at', null)
          .order('display_order'),
        supabase
          .from('product_unit_contexts')
          .select('stock_opname_unit, recipe_unit, purchase_unit, sales_unit')
          .eq('product_id', productId)
          .maybeSingle(),
      ]);
      if (alts.error) throw alts.error;
      if (ctx.error) throw ctx.error;
      return {
        alternatives: (alts.data ?? []) as ProductUnitAlt[],
        contexts:     ctx.data as ProductUnitContexts | null,
      };
    },
  });
}
