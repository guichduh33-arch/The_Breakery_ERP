// apps/backoffice/src/features/inventory/hooks/useWasteStock.ts
//
// Calls `waste_stock_v1` RPC (session 12). Records a negative movement of
// type `waste` and decrements `products.current_stock`. Server enforces
// non-negative invariant.
//
// Server-side errors:
//   P0003 'forbidden'                  — missing inventory.waste
//   ''    'quantity_must_be_positive'  — quantity <= 0
//   P0002 'product_not_found'          — product deleted
//   P0002 'insufficient_stock'         — quantity > current_stock

import { useMutation, useQueryClient } from '@tanstack/react-query';
import type { StockMovementRpcResult } from '@breakery/domain';
import { supabase } from '@/lib/supabase.js';
import { STOCK_LEVELS_QUERY_KEY } from './useStockLevels.js';

export type WasteStockErrorCode =
  | 'forbidden'
  | 'quantity_must_be_positive'
  | 'product_not_found'
  | 'insufficient_stock'
  | 'unknown';

export class WasteStockError extends Error {
  constructor(public code: WasteStockErrorCode, message?: string) {
    super(message ?? code);
    this.name = 'WasteStockError';
  }
}

export interface WasteStockArgs {
  productId:       string;
  quantity:        number;
  reason:          string;
  idempotencyKey:  string;
}

function classify(message: string): WasteStockErrorCode {
  if (message.includes('forbidden'))                 return 'forbidden';
  if (message.includes('quantity_must_be_positive')) return 'quantity_must_be_positive';
  if (message.includes('insufficient_stock'))        return 'insufficient_stock';
  if (message.includes('product_not_found'))         return 'product_not_found';
  return 'unknown';
}

export function useWasteStock() {
  const qc = useQueryClient();
  return useMutation<StockMovementRpcResult, WasteStockError, WasteStockArgs>({
    mutationFn: async ({ productId, quantity, reason, idempotencyKey }) => {
      const { data, error } = await supabase.rpc('waste_stock_v1', {
        p_product_id:      productId,
        p_quantity:        quantity,
        p_reason:          reason,
        p_idempotency_key: idempotencyKey,
      });
      if (error) throw new WasteStockError(classify(error.message), error.message);
      if (data === null) throw new WasteStockError('unknown', 'Empty RPC response');
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
