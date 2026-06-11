// apps/backoffice/src/features/products/hooks/useCorrectCostPrice.ts
//
// Session 39 — Wave B2 — Wraps update_cost_price_v1 (S22).
// Gate: inventory.cost_correction (MANAGER+).
// Returns { movement_id, product_id, old_cost, new_cost, idempotent_replay }.
// Idempotency flavor 2 (S25): useRef(crypto.randomUUID()) held by the caller dialog.

import { useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/lib/supabase.js';

export interface CorrectCostInput {
  newCost:       number;
  reason:        string;
  idempotencyKey: string;
}

export interface CostCorrectionResult {
  movement_id:      string;
  product_id:       string;
  old_cost:         number;
  new_cost:         number;
  idempotent_replay: boolean;
}

export function useCorrectCostPrice(productId: string) {
  const qc = useQueryClient();
  return useMutation<CostCorrectionResult, Error, CorrectCostInput>({
    mutationFn: async (input) => {
      const { data, error } = await supabase.rpc('update_cost_price_v1', {
        p_product_id:      productId,
        p_new_cost:        input.newCost,
        p_reason:          input.reason,
        p_idempotency_key: input.idempotencyKey,
      });
      if (error) throw new Error(error.message);
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      return (data as unknown) as CostCorrectionResult;
    },
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['products', 'detail', productId] });
      void qc.invalidateQueries({ queryKey: ['recipe-bom-full', productId] });
    },
  });
}
