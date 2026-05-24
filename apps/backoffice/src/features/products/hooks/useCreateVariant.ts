// apps/backoffice/src/features/products/hooks/useCreateVariant.ts
//
// Session 27c — Wraps `create_variant_v1`. Creates a new variant under an
// existing parent. Returns the new variant id.

import { useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/lib/supabase.js';

export interface CreateVariantInput {
  parentId:     string;
  variantLabel: string;
  sku:          string;
  retailPrice:  number;
  costPrice?:   number | null;
  unit?:        string | null;
  sortOrder?:   number | null;
  name?:        string | null;
}

export function useCreateVariant() {
  const qc = useQueryClient();
  return useMutation<string, Error, CreateVariantInput>({
    mutationFn: async (input) => {
      const args: {
        p_parent_id:     string;
        p_variant_label: string;
        p_sku:           string;
        p_retail_price:  number;
        p_cost_price?:   number;
        p_unit?:         string;
        p_sort_order?:   number;
        p_name?:         string;
      } = {
        p_parent_id:     input.parentId,
        p_variant_label: input.variantLabel,
        p_sku:           input.sku,
        p_retail_price:  input.retailPrice,
      };
      if (input.costPrice !== null && input.costPrice !== undefined) args.p_cost_price = input.costPrice;
      if (input.unit !== null && input.unit !== undefined && input.unit !== '') args.p_unit = input.unit;
      if (input.sortOrder !== null && input.sortOrder !== undefined) args.p_sort_order = input.sortOrder;
      if (input.name !== null && input.name !== undefined && input.name !== '') args.p_name = input.name;

      const { data, error } = await supabase.rpc('create_variant_v1', args);
      if (error !== null) throw new Error(error.message);
      return data as string;
    },
    onSuccess: async (_id, input) => {
      await Promise.all([
        qc.invalidateQueries({ queryKey: ['product-variants', input.parentId] }),
        qc.invalidateQueries({ queryKey: ['products'] }),
      ]);
    },
  });
}
