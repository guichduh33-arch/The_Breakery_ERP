// apps/backoffice/src/features/products/hooks/useUpdateProduct.ts
// Session 27 — Wave 2 — Wraps update_product_v1 RPC (JSONB patch, 18-col allowlist).
//
// The RPC returns { product, ignored_fields }. We surface ignored_fields back
// so the UI can warn the user if they tried to update something outside the
// whitelist (e.g. cost_price, which goes through update_cost_price_v1).

import { useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/lib/supabase.js';
import type { ProductRow } from '../types.js';

/** Subset of ProductRow that update_product_v1 can write. */
export type ProductUpdatePatch = Partial<Pick<ProductRow,
  | 'name'
  | 'sku'
  | 'category_id'
  | 'description'
  | 'retail_price'
  | 'wholesale_price'
  | 'tax_inclusive'
  | 'image_url'
  | 'is_active'
  | 'is_favorite'
  | 'is_semi_finished'
  | 'visible_on_pos'
  | 'available_for_sale'
  | 'track_inventory'
  | 'deduct_stock'
  | 'min_stock_threshold'
  | 'target_gross_margin_pct'
  | 'default_shelf_life_hours'
>>;

export interface UpdateProductArgs {
  productId: string;
  patch:     ProductUpdatePatch;
}

export interface UpdateProductResult {
  product:        unknown;
  ignored_fields: ReadonlyArray<string>;
}

export function useUpdateProduct() {
  const qc = useQueryClient();
  return useMutation<UpdateProductResult, Error, UpdateProductArgs>({
    mutationFn: async ({ productId, patch }) => {
      // The generated Database type narrows p_patch to Json; ProductUpdatePatch
      // is structurally compatible (primitives + null) but TS can't prove it.
      const { data, error } = await supabase.rpc('update_product_v1', {
        p_product_id: productId,
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        p_patch:      patch as any,
      });
      if (error !== null) throw new Error(error.message);
      const result = data as unknown as UpdateProductResult;
      return {
        product:        result?.product ?? null,
        ignored_fields: Array.isArray(result?.ignored_fields) ? result.ignored_fields : [],
      };
    },
    onSuccess: async (_data, vars) => {
      await Promise.all([
        qc.invalidateQueries({ queryKey: ['products'] }),
        qc.invalidateQueries({ queryKey: ['products', 'detail', vars.productId] }),
      ]);
    },
  });
}
