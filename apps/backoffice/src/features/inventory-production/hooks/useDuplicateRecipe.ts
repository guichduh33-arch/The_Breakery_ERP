// apps/backoffice/src/features/inventory-production/hooks/useDuplicateRecipe.ts
//
// Session 15 / Phase 3.B — duplicate_recipe_v1 RPC wrapper.
//
// Mirrors the error-code surface of useRecordProduction.ts : a typed
// DuplicateRecipeError carries an enum so the caller can render
// inline messages without parsing the raw SQLSTATE message string.

import { useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/lib/supabase.js';

export type DuplicateRecipeErrorCode =
  | 'forbidden'
  | 'product_not_found'
  | 'source_equals_target'
  | 'target_has_active_recipes'
  | 'recipe_cycle_detected'
  | 'unknown';

export class DuplicateRecipeError extends Error {
  constructor(public code: DuplicateRecipeErrorCode, message?: string) {
    super(message ?? code);
    this.name = 'DuplicateRecipeError';
  }
}

export interface DuplicateRecipeArgs {
  sourceProductId: string;
  targetProductId: string;
  idempotencyKey?: string;
}

export interface DuplicateRecipeResult {
  source_product_id: string;
  target_product_id: string;
  rows_copied:       number;
  idempotent_replay: boolean;
}

function classify(message: string): DuplicateRecipeErrorCode {
  if (message.includes('forbidden'))                  return 'forbidden';
  if (message.includes('source_equals_target'))       return 'source_equals_target';
  if (message.includes('target_has_active_recipes'))  return 'target_has_active_recipes';
  if (message.includes('recipe_cycle_detected'))      return 'recipe_cycle_detected';
  if (message.includes('product_not_found'))          return 'product_not_found';
  return 'unknown';
}

export function useDuplicateRecipe() {
  const qc = useQueryClient();
  return useMutation<DuplicateRecipeResult, DuplicateRecipeError, DuplicateRecipeArgs>({
    mutationFn: async (args) => {
      const rpcArgs: {
        p_source_product_id: string;
        p_target_product_id: string;
        p_idempotency_key?:  string;
      } = {
        p_source_product_id: args.sourceProductId,
        p_target_product_id: args.targetProductId,
      };
      if (args.idempotencyKey !== undefined) {
        rpcArgs.p_idempotency_key = args.idempotencyKey;
      }
      const { data, error } = await supabase.rpc('duplicate_recipe_v1', rpcArgs);
      if (error) {
        throw new DuplicateRecipeError(classify(error.message), error.message);
      }
      return data as unknown as DuplicateRecipeResult;
    },
    onSuccess: async (result) => {
      await Promise.all([
        qc.invalidateQueries({
          queryKey: ['inventory-production', 'recipes', result.target_product_id],
        }),
        qc.invalidateQueries({ queryKey: ['inventory-production', 'finished-products'] }),
        qc.invalidateQueries({ queryKey: ['stock-levels'] }),
        qc.invalidateQueries({ queryKey: ['products'] }),
      ]);
    },
  });
}
