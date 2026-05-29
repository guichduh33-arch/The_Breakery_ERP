// apps/backoffice/src/features/orders/hooks/useAddOrderItem.ts
// Session 33 / Wave 2.6 — call add_order_item_v1 RPC.
import { useMutation } from '@tanstack/react-query';
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
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const { data, error } = await (supabase as any).rpc('add_order_item_v1', {
        p_order_id:        args.orderId,
        p_product_id:      args.productId,
        p_qty:             args.qty,
        p_modifiers:       args.modifiers ?? [],
        p_idempotency_key: args.idempotencyKey,
      });
      if (error) throw error;
      return data as Response;
    },
  });
}
