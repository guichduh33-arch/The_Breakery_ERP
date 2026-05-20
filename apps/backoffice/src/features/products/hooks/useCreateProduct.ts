// apps/backoffice/src/features/products/hooks/useCreateProduct.ts
// Session 27b — Wraps create_product_v1 RPC.

import { useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/lib/supabase.js';

export interface CreateProductPayload {
  name:         string;
  sku:          string;
  category_id:  string;
  retail_price?: number;
  unit?:         string;
  description?:  string | null;
  is_active?:    boolean;
  is_favorite?:  boolean;
}

export interface CreateProductResult {
  product:        { id: string; sku: string; name: string } & Record<string, unknown>;
  ignored_fields: ReadonlyArray<string>;
}

export function useCreateProduct() {
  const qc = useQueryClient();
  return useMutation<CreateProductResult, Error, CreateProductPayload>({
    mutationFn: async (payload) => {
      const { data, error } = await supabase.rpc('create_product_v1', {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        p_payload: payload as any,
      });
      if (error !== null) throw new Error(error.message);
      const result = data as unknown as CreateProductResult;
      return {
        product:        result.product,
        ignored_fields: Array.isArray(result.ignored_fields) ? result.ignored_fields : [],
      };
    },
    onSuccess: async () => {
      await qc.invalidateQueries({ queryKey: ['products'] });
    },
  });
}
