// apps/backoffice/src/features/inventory-production/hooks/useDeactivateRecipe.ts
//
// Calls `deactivate_recipe_v1`. Soft-deletes a recipe row.

import { useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/lib/supabase.js';

export interface DeactivateRecipeArgs {
  recipeId:  string;
  productId: string;  // for cache invalidation
}

export function useDeactivateRecipe() {
  const qc = useQueryClient();
  return useMutation<string, Error, DeactivateRecipeArgs>({
    mutationFn: async ({ recipeId }) => {
      const { data, error } = await supabase.rpc('deactivate_recipe_v1', {
        p_recipe_id: recipeId,
      });
      if (error) throw new Error(error.message);
      return data as string;
    },
    onSuccess: async (_id, vars) => {
      await qc.invalidateQueries({ queryKey: ['inventory-production', 'recipes', vars.productId] });
    },
  });
}
