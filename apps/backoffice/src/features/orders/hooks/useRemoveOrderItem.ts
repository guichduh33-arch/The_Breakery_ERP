// apps/backoffice/src/features/orders/hooks/useRemoveOrderItem.ts
// Session 33 / Wave 2.6 — call remove_order_item RPC.
// ADR-010 D5 — v2 : une ligne verrouillée (envoyée en cuisine) REFUSE la
// suppression (check_violation) et renvoie vers le flux cancel POS. L'UI
// n'offre plus le bouton sur ces lignes ; la garde serveur reste le filet.
import { useMutation } from '@tanstack/react-query';
import { supabase } from '@/lib/supabase.js';

interface Args { orderItemId: string; idempotencyKey: string; }
interface Response { order_totals: { subtotal: number; tax_amount: number; total: number }; }

export function useRemoveOrderItem() {
  return useMutation<Response, Error, Args>({
    mutationFn: async (args) => {
      const { data, error } = await supabase.rpc('remove_order_item_v2', {
        p_order_item_id:   args.orderItemId,
        p_idempotency_key: args.idempotencyKey,
      });
      if (error) throw error;
      return data as unknown as Response;
    },
  });
}
