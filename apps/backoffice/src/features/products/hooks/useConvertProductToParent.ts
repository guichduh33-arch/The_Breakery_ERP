// apps/backoffice/src/features/products/hooks/useConvertProductToParent.ts
//
// Session 27c — Wraps `convert_product_to_parent_v1`.
// Converts a standalone product into a parent + creates the first variant
// (the original product is RE-PARENTED to a new parent row). Returns the new
// parent_id.

import { useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/lib/supabase.js';

export interface ConvertToParentInput {
  productId:           string;
  firstVariantLabel:   string;
  variantAxis:         'flavor' | 'size' | 'format';
  firstVariantName?:   string | null;
}

export function useConvertProductToParent() {
  const qc = useQueryClient();
  return useMutation<string, Error, ConvertToParentInput>({
    mutationFn: async (input) => {
      const args: {
        p_product_id:           string;
        p_first_variant_label:  string;
        p_variant_axis:         'flavor' | 'size' | 'format';
        p_first_variant_name?:  string;
      } = {
        p_product_id:          input.productId,
        p_first_variant_label: input.firstVariantLabel,
        p_variant_axis:        input.variantAxis,
      };
      if (typeof input.firstVariantName === 'string' && input.firstVariantName.length > 0) {
        args.p_first_variant_name = input.firstVariantName;
      }
      const { data, error } = await supabase.rpc('convert_product_to_parent_v1', args);
      if (error !== null) throw new Error(error.message);
      return data as string;
    },
    onSuccess: async (_parentId, input) => {
      await Promise.all([
        qc.invalidateQueries({ queryKey: ['products'] }),
        qc.invalidateQueries({ queryKey: ['products', 'detail', input.productId] }),
        qc.invalidateQueries({ queryKey: ['product-variants'] }),
      ]);
    },
  });
}
