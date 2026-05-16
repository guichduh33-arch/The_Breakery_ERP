// apps/backoffice/src/features/inventory-production/hooks/useReorderRecipeRows.ts
//
// Session 15 / Phase 3.B — wraps reorder_recipe_rows_v1 RPC.
//
// The caller passes the full new ordering as an array of recipe ids ;
// the server validates that every id belongs to the given product and
// rewrites display_order in a single atomic UPDATE.

import { useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/lib/supabase.js';

export type ReorderRecipeRowsErrorCode =
  | 'forbidden'
  | 'product_not_found'
  | 'recipe_not_found'
  | 'unknown';

export class ReorderRecipeRowsError extends Error {
  constructor(public code: ReorderRecipeRowsErrorCode, message?: string) {
    super(message ?? code);
    this.name = 'ReorderRecipeRowsError';
  }
}

export interface ReorderRecipeRowsArgs {
  productId: string;
  recipeIds: string[];
}

function classify(message: string): ReorderRecipeRowsErrorCode {
  if (message.includes('forbidden'))         return 'forbidden';
  if (message.includes('product_not_found')) return 'product_not_found';
  if (message.includes('recipe_not_found'))  return 'recipe_not_found';
  return 'unknown';
}

export function useReorderRecipeRows() {
  const qc = useQueryClient();
  return useMutation<number, ReorderRecipeRowsError, ReorderRecipeRowsArgs>({
    mutationFn: async (args) => {
      const { data, error } = await supabase.rpc('reorder_recipe_rows_v1', {
        p_product_id: args.productId,
        p_recipe_ids: args.recipeIds,
      });
      if (error) throw new ReorderRecipeRowsError(classify(error.message), error.message);
      return Number(data ?? 0);
    },
    onSuccess: async (_n, vars) => {
      await qc.invalidateQueries({
        queryKey: ['inventory-production', 'recipes', vars.productId],
      });
    },
  });
}
