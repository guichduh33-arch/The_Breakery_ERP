// apps/pos/src/features/stock/hooks/useReturnToKitchen.ts
//
// POS display-stock isolation — closure gesture "Retour cuisine".
// Wraps `return_display_to_kitchen_v1` (gate display.manage): moves vitrine
// stock back to the kitchen (BO) at end of service.

import { useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/lib/supabase';
import { POS_STOCK_PRODUCTS_KEY } from './usePOSStockProducts';

export interface ReturnToKitchenArgs {
  productId: string;
  quantity: number;
  idempotencyKey: string;
  reason?: string;
}

/** Shared error type for all POS display closure gestures. */
export class DisplayGestureError extends Error {
  constructor(public code: string, message?: string) {
    super(message ?? code);
    this.name = 'DisplayGestureError';
  }
}

function classify(message: string): string {
  if (message.includes('forbidden')) return 'forbidden';
  if (message.includes('insufficient_display_stock')) return 'insufficient_display_stock';
  if (message.includes('quantity_must_be_positive')) return 'quantity_must_be_positive';
  return 'unknown';
}

export function useReturnToKitchen() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (args: ReturnToKitchenArgs) => {
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
      const { data, error } = await supabase.rpc('return_display_to_kitchen_v1', rpcArgs);
      if (error) throw new DisplayGestureError(classify(error.message), error.message);
      return data;
    },
    onSuccess: async () => {
      await qc.invalidateQueries({ queryKey: POS_STOCK_PRODUCTS_KEY });
    },
  });
}
