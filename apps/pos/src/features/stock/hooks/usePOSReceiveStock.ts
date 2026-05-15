// apps/pos/src/features/stock/hooks/usePOSReceiveStock.ts
//
// Session 14 — Phase 2.D — POS-side stock receive.
//
// Wraps `record_incoming_stock_v1` (supplier optional). Used by POSStockView
// to bump stock on a product without a full BO incoming form.

import { useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/lib/supabase';
import { POS_STOCK_PRODUCTS_KEY } from './usePOSStockProducts';

export interface POSReceiveStockArgs {
  productId: string;
  quantity: number;
  idempotencyKey: string;
  reason?: string;
}

export class POSReceiveStockError extends Error {
  constructor(public code: string, message?: string) {
    super(message ?? code);
    this.name = 'POSReceiveStockError';
  }
}

function classify(message: string): string {
  if (message.includes('forbidden')) return 'forbidden';
  if (message.includes('quantity_must_be_positive')) return 'quantity_must_be_positive';
  if (message.includes('product_not_found')) return 'product_not_found';
  return 'unknown';
}

export function usePOSReceiveStock() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (args: POSReceiveStockArgs) => {
      const rpcArgs: {
        p_product_id: string;
        p_quantity: number;
        p_idempotency_key: string;
        p_reason?: string;
      } = {
        p_product_id: args.productId,
        p_quantity: args.quantity,
        p_idempotency_key: args.idempotencyKey,
      };
      if (args.reason !== undefined && args.reason.trim() !== '') {
        rpcArgs.p_reason = args.reason.trim();
      }
      const { data, error } = await supabase.rpc('record_incoming_stock_v1', rpcArgs);
      if (error) throw new POSReceiveStockError(classify(error.message), error.message);
      return data;
    },
    onSuccess: async () => {
      await qc.invalidateQueries({ queryKey: POS_STOCK_PRODUCTS_KEY });
    },
  });
}
