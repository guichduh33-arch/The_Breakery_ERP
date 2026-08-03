// apps/backoffice/src/features/orders/hooks/useAddOrderItem.ts
// Session 33 / Wave 2.6 — call add_order_item RPC.
// ADR-020 déc. 4 (2026-08-03) — v3 → v4 : la ligne est tarifée par
// `_resolve_line_price_v2`, qui consulte le prix négocié du client avant la
// grille par catégorie. Aucun argument ne change.
import { useMutation } from '@tanstack/react-query';
import type { Json } from '@breakery/supabase';
import { supabase } from '@/lib/supabase.js';

interface Args {
  orderId:        string;
  productId:      string;
  qty:            number;
  modifiers?:     unknown[];
  idempotencyKey: string;       // UUID v4 from client (crypto.randomUUID())
}

interface Response {
  order_item_id: string;
  order_totals:  { subtotal: number; tax_amount: number; total: number };
}

export function useAddOrderItem() {
  return useMutation<Response, Error, Args>({
    mutationFn: async (args) => {
      const { data, error } = await supabase.rpc('add_order_item_v4', {
        p_order_id:        args.orderId,
        p_product_id:      args.productId,
        p_qty:             args.qty,
        p_modifiers:       (args.modifiers ?? []) as Json[],
        p_idempotency_key: args.idempotencyKey,
      });
      if (error) throw error;
      return data as unknown as Response;
    },
  });
}
