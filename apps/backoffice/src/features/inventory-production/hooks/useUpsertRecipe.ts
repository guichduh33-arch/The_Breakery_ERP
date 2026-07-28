// apps/backoffice/src/features/inventory-production/hooks/useUpsertRecipe.ts
//
// Calls `upsert_recipe_v2` RPC. Insert-or-update by (product_id, material_id)
// active row. Permission gated by inventory.recipes.update (MANAGER+).
//
// ADR-008 D1, précisé par ADR-016 : le serveur refuse une unité de ligne non
// CONVERTIBLE vers l'unité de stockage de l'article (`unit_not_convertible`).
// L'unité identique n'est pas exigée — « 90 gr » d'une pâte stockée en kg reste
// valide ; c'est la conversion impossible qui est fermée.

import { useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/lib/supabase.js';

export type UpsertRecipeErrorCode =
  | 'forbidden'
  | 'product_not_found'
  | 'material_not_found'
  | 'material_must_differ_from_product'
  | 'quantity_must_be_positive'
  | 'unit_required'
  | 'unit_not_convertible'
  | 'baker_percentage_required'
  | 'unknown';

export class UpsertRecipeError extends Error {
  constructor(public code: UpsertRecipeErrorCode, message?: string) {
    super(message ?? code);
    this.name = 'UpsertRecipeError';
  }
}

export interface UpsertRecipeArgs {
  productId:           string;
  materialId:          string;
  quantity:            number;
  unit:                string;
  notes?:              string | null;
  /** Session 15 / Phase 5.B (spec §D13) — opt-in baker mode flag. */
  isBakerPercentage?:  boolean;
  /** Session 15 / Phase 5.B (spec §D13) — percentage of flour pivot (0..1000). */
  bakerPercentage?:    number;
}

function classify(message: string): UpsertRecipeErrorCode {
  if (message.includes('forbidden'))                      return 'forbidden';
  if (message.includes('material_must_differ'))           return 'material_must_differ_from_product';
  if (message.includes('material_not_found'))             return 'material_not_found';
  if (message.includes('product_not_found'))              return 'product_not_found';
  if (message.includes('quantity_must_be_positive'))      return 'quantity_must_be_positive';
  // Doit précéder le test générique : 'unit_not_convertible' ne contient pas
  // 'unit_required', mais l'ordre reste explicite pour la lisibilité.
  if (message.includes('unit_not_convertible'))           return 'unit_not_convertible';
  if (message.includes('unit_required'))                  return 'unit_required';
  if (message.includes('baker_percentage_required'))      return 'baker_percentage_required';
  return 'unknown';
}

export function useUpsertRecipe() {
  const qc = useQueryClient();
  return useMutation<string, UpsertRecipeError, UpsertRecipeArgs>({
    mutationFn: async (args) => {
      const rpcArgs: {
        p_product_id:           string;
        p_material_id:          string;
        p_quantity:             number;
        p_unit:                 string;
        p_notes?:               string;
        p_is_baker_percentage?: boolean;
        p_baker_percentage?:    number;
      } = {
        p_product_id:  args.productId,
        p_material_id: args.materialId,
        p_quantity:    args.quantity,
        p_unit:        args.unit,
      };
      if (args.notes !== undefined && args.notes !== null) rpcArgs.p_notes = args.notes;
      if (args.isBakerPercentage !== undefined) rpcArgs.p_is_baker_percentage = args.isBakerPercentage;
      if (args.bakerPercentage !== undefined)   rpcArgs.p_baker_percentage    = args.bakerPercentage;
      const { data, error } = await supabase.rpc('upsert_recipe_v2', rpcArgs);
      if (error) throw new UpsertRecipeError(classify(error.message), error.message);
      return data;
    },
    onSuccess: async (_id, vars) => {
      await qc.invalidateQueries({ queryKey: ['inventory-production', 'recipes', vars.productId] });
      await qc.invalidateQueries({ queryKey: ['inventory-production', 'baker-mode', vars.productId] });
      await qc.invalidateQueries({ queryKey: ['inventory-production', 'baker-convert', vars.productId] });
    },
  });
}
