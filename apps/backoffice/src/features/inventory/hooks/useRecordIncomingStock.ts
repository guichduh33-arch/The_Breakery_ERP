// apps/backoffice/src/features/inventory/hooks/useRecordIncomingStock.ts
//
// Calls `record_incoming_stock_v1` RPC (session 12 — Phase 2). Records a
// positive stock movement for a free-form receipt that isn't tied to a
// purchase order. Supplier is OPTIONAL: when omitted, the server records
// the receipt without supplier attribution. unit_cost + reason are also
// optional.
//
// Server-side errors:
//   P0003 'forbidden'                          — missing inventory.receive
//   ''    'quantity_must_be_positive'          — quantity <= 0
//   P0002 'supplier_not_found_or_inactive'     — supplier deleted/inactive
//                                                (only when supplierId provided)
//   P0002 'product_not_found'                  — product deleted or invalid id

import { useMutation, useQueryClient } from '@tanstack/react-query';
import type { StockMovementRpcResult } from '@breakery/domain';
import { supabase } from '@/lib/supabase.js';
import { STOCK_LEVELS_QUERY_KEY } from './useStockLevels.js';

export type RecordIncomingStockErrorCode =
  | 'forbidden'
  | 'quantity_must_be_positive'
  | 'supplier_not_found_or_inactive'
  | 'product_not_found'
  | 'unknown';

export class RecordIncomingStockError extends Error {
  constructor(public code: RecordIncomingStockErrorCode, message?: string) {
    super(message ?? code);
    this.name = 'RecordIncomingStockError';
  }
}

export interface RecordIncomingStockArgs {
  productId:       string;
  quantity:        number;
  /** Optional — when omitted the receipt is recorded without supplier attribution. */
  supplierId?:     string;
  unitCost?:       number;
  reason?:         string;
  idempotencyKey:  string;
}

function classify(message: string): RecordIncomingStockErrorCode {
  if (message.includes('forbidden'))                      return 'forbidden';
  if (message.includes('quantity_must_be_positive'))      return 'quantity_must_be_positive';
  if (message.includes('supplier_not_found_or_inactive')) return 'supplier_not_found_or_inactive';
  if (message.includes('product_not_found'))              return 'product_not_found';
  return 'unknown';
}

export function useRecordIncomingStock() {
  const qc = useQueryClient();
  return useMutation<StockMovementRpcResult, RecordIncomingStockError, RecordIncomingStockArgs>({
    mutationFn: async (args) => {
      const rpcArgs: {
        p_product_id:       string;
        p_quantity:         number;
        p_supplier_id?:     string;
        p_unit_cost?:       number;
        p_reason?:          string;
        p_idempotency_key?: string;
      } = {
        p_product_id:      args.productId,
        p_quantity:        args.quantity,
        p_idempotency_key: args.idempotencyKey,
      };
      if (args.supplierId !== undefined) rpcArgs.p_supplier_id = args.supplierId;
      if (args.unitCost   !== undefined) rpcArgs.p_unit_cost   = args.unitCost;
      if (args.reason     !== undefined && args.reason.trim() !== '') rpcArgs.p_reason = args.reason.trim();

      const { data, error } = await supabase.rpc('record_incoming_stock_v1', rpcArgs);
      if (error) throw new RecordIncomingStockError(classify(error.message), error.message);
      if (data === null) throw new RecordIncomingStockError('unknown', 'Empty RPC response');
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
