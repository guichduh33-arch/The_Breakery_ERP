// apps/backoffice/src/features/products/hooks/useRecipeDirectCost.ts
//
// Wraps recipe_direct_cost_v1 — the DIRECT (depth-1) recipe-line costing used by
// the product Costing tab so the breakdown matches the Recipe tab. Unlike the
// recursive recipe_bom_full_v1, semi-finished lines are costed at their own
// cost_price (which already rolls up their sub-ingredients) instead of being
// exploded into leaf materials.
//
// Same row shape as useRecipeBomFull (BomLine) so CostingPanel renders unchanged.
// Gate: inventory.read (SECURITY DEFINER). 0 rows = no recipe (purchase-driven WAC).

import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/lib/supabase.js';
import type { BomLine } from './useRecipeBomFull.js';

// recipe_direct_cost_v1 is not yet in the generated types (cloud schema lags the
// local migration ledger), so the bound rpc is cast — same pattern as
// useProductAnalytics.
type RpcFn = (
  fn: string, args?: Record<string, unknown>
) => Promise<{ data: BomLine[] | null; error: { message: string } | null }>;

export function useRecipeDirectCost(productId: string) {
  return useQuery<BomLine[]>({
    queryKey: ['recipe-direct-cost', productId] as const,
    enabled:  productId !== '',
    staleTime: 30_000,
    queryFn: async () => {
      const rpc = supabase.rpc.bind(supabase) as unknown as RpcFn;
      const { data, error } = await rpc('recipe_direct_cost_v1', {
        p_product_id: productId,
      });
      if (error !== null) throw new Error(error.message);
      return data ?? [];
    },
  });
}
