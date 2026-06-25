// apps/pos/src/features/cart/hooks/useHoldFiredOrder.ts
// Spec A, Bloc 2 — flag a freshly-fired counter order is_held=true so it leaves
// the terminal and appears in Held Orders ("addition ouverte"). Used by
// SendToKitchenButton after the fire + print succeed.
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/lib/supabase';

export function useHoldFiredOrder() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (orderId: string): Promise<void> => {
      const { error } = await supabase.rpc('hold_fired_order_v1', { p_order_id: orderId });
      if (error) throw error;
    },
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['held-orders'] });
    },
  });
}
