// apps/backoffice/src/features/products/hooks/useDeleteVariant.ts
//
// Session 27c — Wraps `delete_variant_v1` (soft delete via `deleted_at`).

import { useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/lib/supabase.js';

export function useDeleteVariant() {
  const qc = useQueryClient();
  return useMutation<string, Error, string>({
    mutationFn: async (variantId) => {
      const { data, error } = await supabase.rpc('delete_variant_v1', { p_variant_id: variantId });
      if (error !== null) throw new Error(error.message);
      return data as string;
    },
    onSuccess: async () => {
      await qc.invalidateQueries({ queryKey: ['product-variants'] });
    },
  });
}
