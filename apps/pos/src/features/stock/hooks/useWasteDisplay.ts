// apps/pos/src/features/stock/hooks/useWasteDisplay.ts
//
// POS display-stock isolation — closure gesture "Perte".
// Wraps `waste_display_stock_v1` (gate display.manage): writes off vitrine
// stock as waste (also decrements BO stock — returns new_bo_stock).

import { useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/lib/supabase';
import { POS_STOCK_PRODUCTS_KEY } from './usePOSStockProducts';
import { DisplayGestureError } from './useReturnToKitchen';

export interface WasteDisplayArgs {
  productId: string;
  quantity: number;
  idempotencyKey: string;
  reason?: string;
}

function classify(message: string): string {
  if (message.includes('forbidden')) return 'forbidden';
  if (message.includes('insufficient_display_stock')) return 'insufficient_display_stock';
  if (message.includes('quantity_must_be_positive')) return 'quantity_must_be_positive';
  return 'unknown';
}

export function useWasteDisplay() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (args: WasteDisplayArgs) => {
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
      const { data, error } = await supabase.rpc('waste_display_stock_v1', rpcArgs);
      if (error) throw new DisplayGestureError(classify(error.message), error.message);
      return data;
    },
    onSuccess: async () => {
      await qc.invalidateQueries({ queryKey: POS_STOCK_PRODUCTS_KEY });
    },
  });
}
