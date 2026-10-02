import { isCartPaymentLocked } from '@/stores/cartPaymentGuard';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/lib/supabase';
import { useCartStore } from '@/stores/cartStore';
import { useShiftStore } from '@/stores/shiftStore';
import { emitPosEvent } from '@/features/audit/emitPosEvent';
import type { ReopenOrderPayload } from '@/stores/cartStore';
import type { CustomerWithCategory } from '@/features/customers/hooks/useCustomerSearch';

/**
 * Reprend une commande envoyée en attente ou une commande caisse déjà ouverte.
 * Le snapshot conserve les identifiants, verrous et faits d'annulation ; aucune
 * ligne déjà envoyée ne doit être recréée ou réimprimée.
 */
export function useReopenHeldOrder() {
  const qc = useQueryClient();
  return useMutation({
    // Un rejet de la garde panier ne doit jamais relancer la reprise avec un nouvel état.
    retry: false,
    mutationFn: async (orderId: string): Promise<string> => {
      if (isCartPaymentLocked()) throw new Error('Resume the saved payment first');
      const before = useCartStore.getState();
      const sessionId = useShiftStore.getState().current?.id;
      const { data, error } = await supabase.rpc('reopen_held_order_v5', {
        p_order_id: orderId,
        ...(sessionId ? { p_session_id: sessionId } : {}),
      });
      if (error) throw error;
      const payload = data as unknown as ReopenOrderPayload;

      if (useCartStore.getState().cart !== before.cart || useCartStore.getState().pickedUpOrderId !== before.pickedUpOrderId || isCartPaymentLocked()) throw new Error('The current order changed — open the held order again');
      useCartStore.getState().reopenOrder(payload);

      // S72 audit — a held FIRED order was reopened onto this terminal.
      emitPosEvent('order_resumed', {
        order_id: payload.order_id,
        payload: { kind: 'reopen_fired', items: payload.items.length },
      });

      // Best-effort customer badge restore (mirrors useRestoreHeldOrder): pricing
      // runs off cart.customerId (already set by reopenOrder), so a lookup miss
      // just leaves the badge absent. Definer RPC get_customer_v3 survives the
      // customers.read SELECT gate (S50 W1.4: v2 → v3, dual gate).
      if (payload.customerId !== null) {
        try {
          const { data: customers } = await supabase.rpc('get_customer_v3', {
            p_id: payload.customerId,
          });
          const customer = (customers ?? [])[0];
          if (customer && useCartStore.getState().pickedUpOrderId === payload.order_id) {
            useCartStore.getState().attachCustomer({
              ...customer,
              category: (customer as { category?: unknown }).category ?? null,
            } as unknown as CustomerWithCategory);
          }
        } catch {
          // best-effort
        }
      }

      return payload.order_id;
    },
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['held-orders'] });
    },
  });
}
