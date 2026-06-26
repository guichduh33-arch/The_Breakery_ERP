import { useMutation, useQueryClient } from '@tanstack/react-query';
import type { Cart, CartItem, OrderType, SelectedModifiers } from '@breakery/domain';
import { supabase } from '@/lib/supabase';
import { useCartStore } from '@/stores/cartStore';
import type { CustomerWithCategory } from '@/features/customers/hooks/useCustomerSearch';

/**
 * Shape returned by `restore_held_order_v1`. The RPC deletes the held draft
 * server-side and hands back the cart snapshot for rehydration.
 */
interface RestoredHeldOrder {
  order_id: string;
  order_type: string;
  customerId: string | null;
  tableNumber: string | null;
  notes: string | null;
  items: Array<{
    product_id: string;
    name: string;
    quantity: number;
    unit_price: number;
    modifiers: unknown;
  }>;
}

/**
 * Session 35 (F-003) — restore a held draft into the live cart via
 * `restore_held_order_v1`. The RPC deletes the draft on the server; we map its
 * payload into a `Cart` (fresh client-side line ids per item) and replay it
 * through `cartStore.restoreCart`. Exposes `mutateAsync(orderId)` for the UI.
 */
export function useRestoreHeldOrder() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (orderId: string): Promise<string> => {
      const { data, error } = await supabase.rpc('restore_held_order_v1', {
        p_order_id: orderId,
      });
      if (error) throw error;
      const payload = data as unknown as RestoredHeldOrder;

      const items: CartItem[] = (payload.items ?? []).map((it) => ({
        id: crypto.randomUUID(),
        product_id: it.product_id,
        name: it.name,
        unit_price: it.unit_price,
        quantity: it.quantity,
        modifiers: (it.modifiers ?? []) as SelectedModifiers,
      }));

      const cart: Cart = {
        items,
        order_type: payload.order_type as OrderType,
      };
      if (payload.customerId !== null) {
        cart.customerId = payload.customerId;
      }
      if (payload.tableNumber !== null) {
        cart.tableNumber = payload.tableNumber;
      }

      useCartStore.getState().restoreCart(cart);

      // DEV-S35-C-05 — restore_held_order_v1 returns only customerId, and
      // restoreCart resets attachedCustomer to null. Re-fetch the full customer
      // so the badge (name, tier, points) reappears. Best-effort: pricing/JE run
      // off cart.customerId (already set), so a lookup failure just leaves the
      // badge absent rather than blocking the restore.
      // S37 C5 (SEC-03) — via the definer RPC get_customer_v3 (category embed)
      // so the badge re-fetch survives the customers.read SELECT gate.
      // S50 W1.4 — bumped v2 → v3 (dual gate: customers.read OR pos.sale.create).
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
          // Best-effort badge restore — cart.customerId is already set.
        }
      }

      return payload.order_id;
    },
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['held-orders'] });
    },
  });
}
