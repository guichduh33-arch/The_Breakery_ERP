// apps/backoffice/src/features/inventory/hooks/useReceiveStock.ts
//
// Calls `receive_stock_v1` RPC (session 12). Records a positive movement and
// auto-bumps `products.current_stock`. Supplier required, unit_cost optional.
//
// Server-side errors:
//   P0003 'forbidden'                          — missing inventory.receive
//   ''    'quantity_must_be_positive'          — quantity <= 0
//   P0002 'supplier_not_found_or_inactive'     — supplier deleted/inactive
//   P0002 'product_not_found'                  — product deleted or invalid id

import { useMutation, useQueryClient } from '@tanstack/react-query';
import type { StockMovementRpcResult } from '@breakery/domain';
import { supabase } from '@/lib/supabase.js';
import { STOCK_LEVELS_QUERY_KEY } from './useStockLevels.js';

export type ReceiveStockErrorCode =
  | 'forbidden'
  | 'quantity_must_be_positive'
  | 'supplier_not_found_or_inactive'
  | 'product_not_found'
  | 'unknown';

export class ReceiveStockError extends Error {
  constructor(public code: ReceiveStockErrorCode, message?: string) {
    super(message ?? code);
    this.name = 'ReceiveStockError';
  }
}

export interface ReceiveStockArgs {
  productId:       string;
  quantity:        number;
  supplierId:      string;
  unitCost?:       number;
  reason?:         string;
  idempotencyKey:  string;
}

function classify(message: string): ReceiveStockErrorCode {
  if (message.includes('forbidden'))                     return 'forbidden';
  if (message.includes('quantity_must_be_positive'))     return 'quantity_must_be_positive';
  if (message.includes('supplier_not_found_or_inactive')) return 'supplier_not_found_or_inactive';
  if (message.includes('product_not_found'))             return 'product_not_found';
  return 'unknown';
}

export function useReceiveStock() {
  const qc = useQueryClient();
  return useMutation<StockMovementRpcResult, ReceiveStockError, ReceiveStockArgs>({
    mutationFn: async (args) => {
      const rpcArgs: {
        p_product_id:       string;
        p_quantity:         number;
        p_supplier_id:      string;
        p_unit_cost?:       number;
        p_reason?:          string;
        p_idempotency_key?: string;
      } = {
        p_product_id:      args.productId,
        p_quantity:        args.quantity,
        p_supplier_id:     args.supplierId,
        p_idempotency_key: args.idempotencyKey,
      };
      if (args.unitCost !== undefined) rpcArgs.p_unit_cost = args.unitCost;
      if (args.reason   !== undefined && args.reason.trim() !== '') rpcArgs.p_reason = args.reason.trim();

      const { data, error } = await supabase.rpc('receive_stock_v1', rpcArgs);
      if (error) throw new ReceiveStockError(classify(error.message), error.message);
      if (data === null) throw new ReceiveStockError('unknown', 'Empty RPC response');
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
