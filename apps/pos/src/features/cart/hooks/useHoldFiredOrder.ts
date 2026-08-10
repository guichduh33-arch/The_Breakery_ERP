// apps/pos/src/features/cart/hooks/useHoldFiredOrder.ts
// Spec A, Bloc 2 — flag a freshly-fired counter order is_held=true so it leaves
// the terminal and appears in Held Orders ("addition ouverte"). Used by
// SendToKitchenButton after the fire + print succeed.
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/lib/supabase';
import { emitPosEvent } from '@/features/audit/emitPosEvent';

export function useHoldFiredOrder() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (orderId: string): Promise<void> => {
      const { error } = await supabase.rpc('hold_fired_order_v1', { p_order_id: orderId });
      if (error) throw error;
      // ADR-022 déc. 4 — c'est désormais la SEULE mise en attente. L'émission de
      // `order_held` vivait sur le parcage du panier, qui disparaît : sans ce
      // déplacement, « Order held » sortait du journal d'activité. Le kind
      // existe déjà, aucun format ne change.
      emitPosEvent('order_held', { order_id: orderId, payload: { kind: 'hold_fired' } });
    },
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['held-orders'] });
    },
  });
}
