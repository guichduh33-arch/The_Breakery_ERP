// apps/backoffice/src/features/products/hooks/useSetProductBaseUnit.ts
//
// 2026-06-17 — Wraps set_product_base_unit_v1: changes products.unit (base/stock
// unit). Gate: products.units.update. The RPC refuses when stock/movements exist
// (base_unit_change_requires_zero_stock) and resets alternative units + contexts.

import { useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/lib/supabase.js';

export interface SetBaseUnitResult {
  product_id: string;
  old_unit: string;
  new_unit: string;
  cost_price_converted: boolean;
}

export function useSetProductBaseUnit(productId: string) {
  const qc = useQueryClient();
  return useMutation<SetBaseUnitResult, Error, string>({
    mutationFn: async (newUnit) => {
      const { data, error } = await supabase.rpc('set_product_base_unit_v1', {
        p_product_id: productId,
        p_new_unit: newUnit,
      });
      if (error !== null) throw new Error(error.message);
      return data as unknown as SetBaseUnitResult;
    },
    onSuccess: () => {
      // Base unit drives the product row, its units, and every recipe cost.
      void qc.invalidateQueries({ queryKey: ['products', 'detail', productId] });
      void qc.invalidateQueries({ queryKey: ['product-units', productId] });
      void qc.invalidateQueries({ queryKey: ['recipe-bom-full'] });
      void qc.invalidateQueries({ queryKey: ['recipe-detail'] });
    },
  });
}
