import { useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/lib/supabase';

/**
 * Session 35 (F-003) — discard a held draft via `discard_held_order_v1`
 * (gate `orders.void`). The reason must be ≥10 chars (enforced server-side);
 * callers are expected to prompt for it.
 */
export function useDiscardHeldOrder() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ orderId, reason }: { orderId: string; reason: string }) => {
      const { error } = await supabase.rpc('discard_held_order_v1', {
        p_order_id: orderId,
        p_reason: reason,
      });
      if (error) throw error;
    },
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['held-orders'] });
    },
  });
}
