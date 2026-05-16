// apps/backoffice/src/features/inventory-production/hooks/useBakerRecipeMode.ts
//
// Session 15 / Phase 5.B — hooks around baker's percentage mode (spec §D13).
//
// Three hooks :
//   * useBakerRecipeMode(productId)        — reads the mode flag for a product
//                                            (heuristic : all active rows share
//                                            the same mode, so we read the first
//                                            active row).
//   * useToggleBakerMode()                 — flips the mode flag across all
//                                            active rows for the product.
//   * useConvertBakerToAbsolute(...)       — wraps convert_baker_recipe_to_absolute_v1.

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/lib/supabase.js';

export const BAKER_MODE_KEY = (productId: string) =>
  ['inventory-production', 'baker-mode', productId] as const;

export const BAKER_CONVERT_KEY = (productId: string, target: number) =>
  ['inventory-production', 'baker-convert', productId, target] as const;

export interface BakerConvertRow {
  recipe_id:        string;
  material_id:      string;
  material_name:    string;
  baker_percentage: number;
  absolute_qty:     number;
  unit:             string;
}

export interface BakerConvertResult {
  product_id:       string;
  target_flour_qty: number;
  rows:             BakerConvertRow[];
}

/**
 * Reads whether the product's active recipe rows are in baker's-percentage
 * mode. Per spec §D13 the mode is uniform across active rows, so we sample
 * the first one. Returns `false` when there are no rows yet (sensible default
 * for the first ingredient added to a new recipe).
 */
export function useBakerRecipeMode(productId: string | null) {
  return useQuery<boolean>({
    queryKey:  ['inventory-production', 'baker-mode', productId ?? ''],
    enabled:   productId !== null && productId !== '',
    staleTime: 30_000,
    queryFn: async () => {
      const { data, error } = await supabase
        .from('recipes')
        .select('is_baker_percentage')
        .eq('product_id', productId!)
        .eq('is_active', true)
        .is('deleted_at', null)
        .limit(1);
      if (error) throw new Error(error.message);
      const rows = (data ?? []) as Array<{ is_baker_percentage: boolean }>;
      return rows[0]?.is_baker_percentage === true;
    },
  });
}

/**
 * Mutation : flip baker mode for ALL active rows of a product.
 *
 * When toggling OFF, `baker_percentage` is also nulled to keep the column
 * clean (flat-mode rows must not carry stale percentages). When toggling ON,
 * `baker_percentage` is left untouched ; the UI is responsible for forcing
 * the user to fill it in before re-saving (the CHECK constraint will reject
 * any NULL on a baker row at write time).
 *
 * Note : this is a direct UPDATE on the table — bypassing RPCs is acceptable
 * here because the change is column-scoped and RLS still applies. If you need
 * audit-log entries for every mode flip, route through a dedicated RPC.
 */
export interface ToggleBakerArgs {
  productId: string;
  next:      boolean;
}

export function useToggleBakerMode() {
  const qc = useQueryClient();
  return useMutation<void, Error, ToggleBakerArgs>({
    mutationFn: async ({ productId, next }) => {
      const patch: { is_baker_percentage: boolean; baker_percentage?: null } =
        next ? { is_baker_percentage: true } : { is_baker_percentage: false, baker_percentage: null };
      const { error } = await supabase
        .from('recipes')
        .update(patch)
        .eq('product_id', productId)
        .eq('is_active', true)
        .is('deleted_at', null);
      if (error) throw new Error(error.message);
    },
    onSuccess: async (_void, vars) => {
      await Promise.all([
        qc.invalidateQueries({ queryKey: ['inventory-production', 'baker-mode', vars.productId] }),
        qc.invalidateQueries({ queryKey: ['inventory-production', 'recipes',     vars.productId] }),
      ]);
    },
  });
}

/**
 * Reads the absolute quantities that the current baker rows would expand to
 * for a given target flour qty. Disabled when productId is null, when target
 * <= 0, or when baker mode is OFF.
 */
export function useConvertBakerToAbsolute(
  productId:      string | null,
  targetFlourQty: number,
  enabled:        boolean,
) {
  return useQuery<BakerConvertResult>({
    queryKey:  ['inventory-production', 'baker-convert', productId ?? '', targetFlourQty],
    enabled:   enabled && productId !== null && productId !== '' && Number.isFinite(targetFlourQty) && targetFlourQty > 0,
    staleTime: 5_000,
    queryFn: async () => {
      const { data, error } = await supabase.rpc('convert_baker_recipe_to_absolute_v1', {
        p_product_id:       productId!,
        p_target_flour_qty: targetFlourQty,
      });
      if (error) throw new Error(error.message);
      return data as unknown as BakerConvertResult;
    },
  });
}
