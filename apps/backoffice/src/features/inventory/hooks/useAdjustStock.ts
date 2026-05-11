// apps/backoffice/src/features/inventory/hooks/useAdjustStock.ts
//
// Calls `adjust_stock_v1` RPC (session 12). Surfaces RPC errors as a typed
// enum so the modal can map them to inline form errors. Pattern mirrors
// useAdjustLoyaltyPoints.ts.
//
// Server-side errors observed:
//   P0003 'forbidden'                 — missing inventory.adjust
//   ''    'negative_qty_not_allowed'  — guarded client-side but defended
//   P0002 'product_not_found'         — product deleted or invalid id
//   ''    'reason_required'           — reason blank or < 3 chars

import { useMutation, useQueryClient } from '@tanstack/react-query';
import type { StockMovementRpcResult } from '@breakery/domain';
import { supabase } from '@/lib/supabase.js';
import { STOCK_LEVELS_QUERY_KEY } from './useStockLevels.js';

export type AdjustStockErrorCode =
  | 'forbidden'
  | 'negative_qty_not_allowed'
  | 'product_not_found'
  | 'reason_required'
  | 'unknown';

export class AdjustStockError extends Error {
  constructor(public code: AdjustStockErrorCode, message?: string) {
    super(message ?? code);
    this.name = 'AdjustStockError';
  }
}

export interface AdjustStockArgs {
  productId:       string;
  newQty:          number;
  reason:          string;
  idempotencyKey:  string;
}

function classify(message: string): AdjustStockErrorCode {
  if (message.includes('forbidden'))                return 'forbidden';
  if (message.includes('negative_qty_not_allowed')) return 'negative_qty_not_allowed';
  if (message.includes('product_not_found'))        return 'product_not_found';
  if (message.includes('reason_required'))          return 'reason_required';
  return 'unknown';
}

export function useAdjustStock() {
  const qc = useQueryClient();
  return useMutation<StockMovementRpcResult, AdjustStockError, AdjustStockArgs>({
    mutationFn: async ({ productId, newQty, reason, idempotencyKey }) => {
      const { data, error } = await supabase.rpc('adjust_stock_v1', {
        p_product_id:      productId,
        p_new_qty:         newQty,
        p_reason:          reason,
        p_idempotency_key: idempotencyKey,
      });
      if (error) throw new AdjustStockError(classify(error.message), error.message);
      if (data === null) throw new AdjustStockError('unknown', 'Empty RPC response');
      return data as unknown as StockMovementRpcResult;
    },
    onSuccess: async (_data, vars) => {
      await Promise.all([
        qc.invalidateQueries({ queryKey: STOCK_LEVELS_QUERY_KEY }),
        qc.invalidateQueries({ queryKey: ['stock-movements', vars.productId] }),
      ]);
    },
  });
}
