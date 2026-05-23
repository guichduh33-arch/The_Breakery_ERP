// apps/backoffice/src/features/products/hooks/useReorderVariants.ts
//
// Session 27c — Wraps `reorder_variants_v1`. Sets `variant_sort_order = 10,
// 20, 30, ...` for each variant in the supplied id-array (complete-coverage
// gate: the RPC raises if the array doesn't match all active variants of the
// parent). Returns the number of rows updated.

import { useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/lib/supabase.js';

export interface ReorderVariantsInput {
  parentId:   string;
  orderedIds: ReadonlyArray<string>;
}

export function useReorderVariants() {
  const qc = useQueryClient();
  return useMutation<number, Error, ReorderVariantsInput>({
    mutationFn: async ({ parentId, orderedIds }) => {
      const { data, error } = await supabase.rpc('reorder_variants_v1', {
        p_parent_id:           parentId,
        p_ordered_variant_ids: [...orderedIds],
      });
      if (error !== null) throw new Error(error.message);
      return Number(data ?? 0);
    },
    onSuccess: async (_count, { parentId }) => {
      await qc.invalidateQueries({ queryKey: ['product-variants', parentId] });
    },
  });
}
