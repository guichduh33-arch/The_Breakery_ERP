// apps/backoffice/src/features/products/hooks/useUpdateVariant.ts
//
// Session 27c — Wraps `update_variant_v1` JSONB patch. Returns the variant id.

import { useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/lib/supabase.js';

export interface UpdateVariantPatch {
  variant_label?:      string;
  sku?:                string;
  retail_price?:       number;
  variant_sort_order?: number;
}

export interface UpdateVariantInput {
  variantId: string;
  patch:     UpdateVariantPatch;
}

export function useUpdateVariant() {
  const qc = useQueryClient();
  return useMutation<string, Error, UpdateVariantInput>({
    mutationFn: async ({ variantId, patch }) => {
      const { data, error } = await supabase.rpc('update_variant_v1', {
        p_variant_id: variantId,
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        p_patch: patch as any,
      });
      if (error !== null) throw new Error(error.message);
      return data as string;
    },
    onSuccess: async () => {
      await qc.invalidateQueries({ queryKey: ['product-variants'] });
    },
  });
}
