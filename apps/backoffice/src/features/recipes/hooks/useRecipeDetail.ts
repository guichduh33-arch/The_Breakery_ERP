// apps/backoffice/src/features/recipes/hooks/useRecipeDetail.ts
//
// Session 31 / Wave 2.C — Read-only recipe detail for /backoffice/inventory/recipes/:productId.
//
// The Breakery recipes are stored per-ingredient-row (table `recipes` is M2M between
// products(output) and products(material/ingredient)). A "recipe" = the set of rows
// sharing the same `product_id` (= output product). So this page is keyed on productId,
// not on a single recipe row id.

import { useQuery } from '@tanstack/react-query';
import { supabase } from '@breakery/supabase';

export interface BomRow {
  material_id: string;
  material_name: string;
  material_unit: string;
  qty_per_unit: number;
  current_stock: number;
  cost_price: number;
}

export interface RecipeProduct {
  id: string;
  name: string;
  sku: string | null;
  unit: string | null;
  cost_price: number;
  is_semi_finished: boolean;
}

export interface RecipeDetail {
  product: RecipeProduct;
  active_version_number: number | null;
  version_count: number;
  bom: BomRow[];
  total_cost: number;
}

export function useRecipeDetail(productId: string | undefined) {
  return useQuery({
    queryKey: ['recipe-detail', productId],
    enabled: !!productId,
    queryFn: async (): Promise<RecipeDetail> => {
      if (!productId) throw new Error('productId required');

      const { data: product, error } = await supabase
        .from('products')
        .select('id, name, sku, unit, cost_price, is_semi_finished')
        .eq('id', productId)
        .single();
      if (error) throw error;

      const { data: versions } = await supabase
        .from('recipe_versions')
        .select('version_number')
        .eq('product_id', productId)
        .order('version_number', { ascending: false });

      const { data: bomRaw, error: bomErr } = await supabase.rpc('recipe_bom_full_v1', {
        p_product_id: productId,
        p_max_depth: 5,
      });
      if (bomErr) throw bomErr;
      const bom = ((bomRaw ?? []) as BomRow[]).map((r) => ({
        ...r,
        qty_per_unit: Number(r.qty_per_unit ?? 0),
        current_stock: Number(r.current_stock ?? 0),
        cost_price: Number(r.cost_price ?? 0),
      }));

      const total_cost = bom.reduce(
        (sum, r) => sum + r.qty_per_unit * r.cost_price,
        0,
      );

      return {
        product: product as RecipeProduct,
        active_version_number: versions?.[0]?.version_number ?? null,
        version_count: versions?.length ?? 0,
        bom,
        total_cost,
      };
    },
  });
}
