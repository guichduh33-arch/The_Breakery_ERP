// apps/pos/src/features/stock/hooks/useWasteDisplay.ts
//
// POS display-stock isolation — closure gesture "Perte".
// Enveloppe la famille `waste_display_stock` (gate display.manage) : déclare une
// perte vitrine soumise à l'approbation du propriétaire.
// S1-18 — le motif vient de la liste fermée `waste_reason` ; la note est
// facultative (au moins 3 caractères si présente, exigée pour `other`).

import { useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/lib/supabase';
import { POS_STOCK_PRODUCTS_KEY } from './usePOSStockProducts';
import { DisplayGestureError } from './useReturnToKitchen';
import type { WasteReason } from '../wasteReasons';

export interface WasteDisplayArgs {
  productId: string;
  quantity: number;
  idempotencyKey: string;
  wasteReason: WasteReason;
  note?: string;
}

function classify(message: string): string {
  if (message.includes('forbidden')) return 'forbidden';
  if (message.includes('insufficient_display_stock')) return 'insufficient_display_stock';
  if (message.includes('quantity_must_be_positive') || message.includes('invalid_quantity')) return 'quantity_must_be_positive';
  if (message.includes('waste_reason_required')) return 'waste_reason_required';
  if (message.includes('reason_required')) return 'reason_required';
  return 'unknown';
}

export function useWasteDisplay() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (args: WasteDisplayArgs) => {
      const rpcArgs: {
        p_product_id: string;
        p_quantity: number;
        p_waste_reason: WasteReason;
        p_idempotency_key: string;
        p_note?: string;
      } = {
        p_product_id: args.productId,
        p_quantity: args.quantity,
        p_waste_reason: args.wasteReason,
        p_idempotency_key: args.idempotencyKey,
      };
      if (args.note !== undefined && args.note.trim() !== '') {
        rpcArgs.p_note = args.note.trim();
      }
      const { data, error } = await supabase.rpc('waste_display_stock_v5', rpcArgs);
      if (error) throw new DisplayGestureError(classify(error.message), error.message);
      return data;
    },
    onSuccess: async () => {
      await qc.invalidateQueries({ queryKey: POS_STOCK_PRODUCTS_KEY });
      // S43 P1-1 — la grille dérive is_sellable de display_stock : un restock vitrine doit la rafraîchir.
      void qc.invalidateQueries({ queryKey: ['products'] });
      void qc.invalidateQueries({ queryKey: ['pos-product-variants'] });
      void qc.invalidateQueries({ queryKey: ['pos-product-variants-batch'] });
    },
  });
}
