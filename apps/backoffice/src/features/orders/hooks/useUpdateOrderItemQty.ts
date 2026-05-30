// apps/backoffice/src/features/orders/hooks/useUpdateOrderItemQty.ts
// Session 33 / Wave 2.6 — call update_order_item_qty_v1 RPC.
import { useMutation } from '@tanstack/react-query';
import { supabase } from '@/lib/supabase.js';

interface Args { orderItemId: string; qty: number; idempotencyKey: string; }
interface Response { order_totals: { subtotal: number; tax_amount: number; total: number }; }

export function useUpdateOrderItemQty() {
  return useMutation<Response, Error, Args>({
    mutationFn: async (args) => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const { data, error } = await (supabase as any).rpc('update_order_item_qty_v1', {
        p_order_item_id:   args.orderItemId,
        p_qty:             args.qty,
        p_idempotency_key: args.idempotencyKey,
      });
      if (error) throw error;
      return data as Response;
    },
  });
}
