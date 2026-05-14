// apps/backoffice/src/features/inventory-production/hooks/useRecipes.ts
//
// Lists active recipe rows for a given finished product via `list_recipes_v1`.
// JSONB rows are deserialized into RecipeRow shape (matching the domain type).

import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/lib/supabase.js';
import type { RecipeRow } from '@breakery/domain';

export const RECIPES_QUERY_KEY = (productId: string) =>
  ['inventory-production', 'recipes', productId] as const;

export function useRecipes(productId: string | null) {
  return useQuery<RecipeRow[]>({
    queryKey: ['inventory-production', 'recipes', productId ?? ''],
    enabled: productId !== null && productId !== '',
    staleTime: 30_000,
    queryFn: async () => {
      const { data, error } = await supabase.rpc('list_recipes_v1', {
        p_product_id: productId!,
      });
      if (error) throw new Error(error.message);
      // data is SETOF JSONB → supabase-js returns Json[] which is union-typed.
      const rows = (data ?? []) as unknown as RecipeRow[];
      return rows;
    },
  });
}
