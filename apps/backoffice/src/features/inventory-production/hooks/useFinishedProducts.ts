// apps/backoffice/src/features/inventory-production/hooks/useFinishedProducts.ts
//
// List of finished products (product_type='finished') with an active recipe.
// Used by ProductionForm + RecipeEditor's product picker.

import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/lib/supabase.js';

export interface FinishedProductOption {
  id: string;
  sku: string;
  name: string;
  unit: string;
  current_stock: number;
  cost_price: number;
  has_active_recipe: boolean;
}

export function useFinishedProducts(opts?: { withRecipeOnly?: boolean }) {
  return useQuery<FinishedProductOption[]>({
    queryKey: ['inventory-production', 'finished-products', opts] as const,
    staleTime: 60_000,
    queryFn: async () => {
      const { data, error } = await supabase
        .from('products')
        .select('id, sku, name, unit, current_stock, cost_price')
        .eq('product_type', 'finished')
        .eq('is_active', true)
        .is('deleted_at', null)
        .order('name')
        .limit(500);
      if (error) throw error;

      // Fetch active recipe product_ids to mark `has_active_recipe`.
      const { data: recRows, error: recErr } = await supabase
        .from('recipes')
        .select('product_id')
        .eq('is_active', true)
        .is('deleted_at', null)
        .limit(2000);
      if (recErr) throw recErr;
      const withRecipe = new Set((recRows ?? []).map((r) => r.product_id as string));

      const all = (data ?? []).map((p) => ({
        id: p.id,
        sku: p.sku,
        name: p.name,
        unit: p.unit,
        current_stock: Number(p.current_stock),
        cost_price: Number(p.cost_price),
        has_active_recipe: withRecipe.has(p.id),
      }));
      return opts?.withRecipeOnly ? all.filter((p) => p.has_active_recipe) : all;
    },
  });
}
