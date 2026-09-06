// apps/backoffice/src/features/products/hooks/useSetProductUnits.ts
//
// Session 39 — Wave B1 — Wraps set_product_units_v2 (S27, REPLACE semantics).
// Gate: products.units.update (MANAGER+).

import { useMutation, useQueryClient } from '@tanstack/react-query';
import type { Json } from '@breakery/supabase';
import { supabase } from '@/lib/supabase.js';
import type { ProductUnitAlt, ProductUnitContexts } from './useProductUnits.js';

export interface SetProductUnitsPayload {
  alts:     ProductUnitAlt[];
  contexts: ProductUnitContexts;
}

export function useSetProductUnits(productId: string) {
  const qc = useQueryClient();
  return useMutation<unknown, Error, SetProductUnitsPayload>({
    mutationFn: async (payload) => {
      const { data, error } = await supabase.rpc('set_product_units_v2', {
        p_product_id: productId,
        p_alts:       payload.alts as unknown as Json,
        p_contexts:   payload.contexts as unknown as Json,
      });
      if (error !== null) throw new Error(error.message);
      return data;
    },
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['product-units', productId] });
    },
  });
}
