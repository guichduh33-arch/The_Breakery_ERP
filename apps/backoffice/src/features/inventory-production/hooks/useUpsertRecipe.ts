// apps/backoffice/src/features/inventory-production/hooks/useUpsertRecipe.ts
//
// Calls `upsert_recipe_v1` RPC. Insert-or-update by (product_id, material_id)
// active row. Permission gated by inventory.recipes.update (MANAGER+).

import { useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/lib/supabase.js';

export type UpsertRecipeErrorCode =
  | 'forbidden'
  | 'product_not_found'
  | 'material_not_found'
  | 'material_must_differ_from_product'
  | 'quantity_must_be_positive'
  | 'unit_required'
  | 'unknown';

export class UpsertRecipeError extends Error {
  constructor(public code: UpsertRecipeErrorCode, message?: string) {
    super(message ?? code);
    this.name = 'UpsertRecipeError';
  }
}

export interface UpsertRecipeArgs {
  productId:   string;
  materialId:  string;
  quantity:    number;
  unit:        string;
  notes?:      string | null;
}

function classify(message: string): UpsertRecipeErrorCode {
  if (message.includes('forbidden'))                      return 'forbidden';
  if (message.includes('material_must_differ'))           return 'material_must_differ_from_product';
  if (message.includes('material_not_found'))             return 'material_not_found';
  if (message.includes('product_not_found'))              return 'product_not_found';
  if (message.includes('quantity_must_be_positive'))      return 'quantity_must_be_positive';
  if (message.includes('unit_required'))                  return 'unit_required';
  return 'unknown';
}

export function useUpsertRecipe() {
  const qc = useQueryClient();
  return useMutation<string, UpsertRecipeError, UpsertRecipeArgs>({
    mutationFn: async (args) => {
      const rpcArgs: {
        p_product_id:  string;
        p_material_id: string;
        p_quantity:    number;
        p_unit:        string;
        p_notes?:      string;
      } = {
        p_product_id:  args.productId,
        p_material_id: args.materialId,
        p_quantity:    args.quantity,
        p_unit:        args.unit,
      };
      if (args.notes !== undefined && args.notes !== null) rpcArgs.p_notes = args.notes;
      const { data, error } = await supabase.rpc('upsert_recipe_v1', rpcArgs);
      if (error) throw new UpsertRecipeError(classify(error.message), error.message);
      return data as string;
    },
    onSuccess: async (_id, vars) => {
      await qc.invalidateQueries({ queryKey: ['inventory-production', 'recipes', vars.productId] });
    },
  });
}
