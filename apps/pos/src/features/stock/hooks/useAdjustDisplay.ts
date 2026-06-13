// apps/pos/src/features/stock/hooks/useAdjustDisplay.ts
//
// POS display-stock isolation — closure gesture "Ajuster".
// Wraps `adjust_display_stock_v1` (gate display.manage): sets the vitrine
// counter to an absolute new quantity after a physical recount. Reason
// is REQUIRED (>= 3 chars, enforced by the RPC).

import { useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/lib/supabase';
import { POS_STOCK_PRODUCTS_KEY } from './usePOSStockProducts';
import { DisplayGestureError } from './useReturnToKitchen';

export interface AdjustDisplayArgs {
  productId: string;
  newQty: number;
  reason: string;
  idempotencyKey: string;
}

function classify(message: string): string {
  if (message.includes('not_a_display_item')) return 'not_a_display_item';
  if (message.includes('reason_required')) return 'reason_required';
  if (message.includes('forbidden')) return 'forbidden';
  if (message.includes('quantity_must_be_non_negative')) return 'quantity_must_be_non_negative';
  return 'unknown';
}

export function useAdjustDisplay() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (args: AdjustDisplayArgs) => {
      const { data, error } = await supabase.rpc('adjust_display_stock_v1', {
        p_product_id: args.productId,
        p_new_qty: args.newQty,
        p_reason: args.reason,
        p_idempotency_key: args.idempotencyKey,
      });
      if (error) throw new DisplayGestureError(classify(error.message), error.message);
      return data;
    },
    onSuccess: async () => {
      await qc.invalidateQueries({ queryKey: POS_STOCK_PRODUCTS_KEY });
      // S43 P1-1 — la grille dérive is_sellable de display_stock : un restock vitrine doit la rafraîchir.
      void qc.invalidateQueries({ queryKey: ['products'] });
    },
  });
}
