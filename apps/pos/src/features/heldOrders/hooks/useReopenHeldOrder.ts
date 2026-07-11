import { useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/lib/supabase';
import { useCartStore } from '@/stores/cartStore';
import { emitPosEvent } from '@/features/audit/emitPosEvent';
import type { ReopenOrderPayload } from '@/stores/cartStore';
import type { CustomerWithCategory } from '@/features/customers/hooks/useCustomerSearch';

/**
 * Spec A, Bloc 3 — reopen a held FIRED order (status='pending_payment') via
 * reopen_held_order_v1. Unlike useRestoreHeldOrder (draft, deletes server-side,
 * fresh ids), this preserves order_items.id + lock state so already-fired lines
 * stay non-editable / non-reprinted. The RPC claims the order (is_held=false).
 */
export function useReopenHeldOrder() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (orderId: string): Promise<string> => {
      const { data, error } = await supabase.rpc('reopen_held_order_v1', {
        p_order_id: orderId,
      });
      if (error) throw error;
      const payload = data as unknown as ReopenOrderPayload;

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
          if (customer) {
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
