// apps/pos/src/features/customers/hooks/useLoadDebtOrder.ts
//
// Session 60 — Task 1 (fiche 02 D1.1) — pay an outstanding retail "ardoise"
// (counter-fired order left unpaid) directly from `/pos/debts`.
//
// Mirror of `usePickupTabletOrder` (apps/pos/src/features/inbox/hooks/
// usePickupTabletOrder.ts): loads the persisted order_items into the cart and
// sets `pickedUpOrderId`, which routes `useCheckout` to `pay_existing_order_v13`.
// Unlike the tablet pickup, this order was already counter-fired (fully
// printed) — every line is marked BOTH locked AND printed so useCheckout's
// append guard (`isCounterFired && unsynced.length > 0`) sees zero unsynced
// items and skips straight to payment instead of re-firing the whole order.
//
// Does NOT call `reopen_held_order_v2` or `pickup_tablet_order` — those gates
// don't apply to a plain counter ardoise (no held/tablet claim to make).
import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { toast } from 'sonner';
import { supabase } from '@/lib/supabase';
import { useCartStore } from '@/stores/cartStore';
import { fetchOrderSnapshot } from '@/features/inbox/hooks/fetchOrderSnapshot';
import { isCartPaymentLocked } from '@/stores/cartPaymentGuard';
import type { CustomerWithCategory } from './useCustomerSearch';
import type { OutstandingOrder } from './useOutstandingDebts';

export function useLoadDebtOrder() {
  const [isLoading, setIsLoading] = useState(false);
  const navigate = useNavigate();

  const loadDebtOrder = async (order: OutstandingOrder, customerId: string): Promise<void> => {
    if (isLoading || isCartPaymentLocked()) return;
    const cartStore = useCartStore.getState();
    if (cartStore.cart.items.length > 0) {
      const confirmed = window.confirm('Replace the current cart with this unpaid order?');
      if (!confirmed) return;
    }

    setIsLoading(true);
    try {
      const snapshot = await fetchOrderSnapshot(order.id);
      if (useCartStore.getState().cart !== cartStore.cart || isCartPaymentLocked()) throw new Error('The current order changed — open this unpaid order again');
      if (!snapshot.items.some((item) => !item.is_cancelled)) throw new Error('No payable items on this order');
      useCartStore.getState().applyOrderSnapshot(snapshot, true);

      // Best-effort customer badge attach (pattern: useReopenHeldOrder) — a
      // lookup miss just leaves the badge absent, pricing already runs off
      // cart.customerId set indirectly via attachCustomer below.
      try {
        const { data: customers } = await supabase.rpc('get_customer_v3', { p_id: customerId });
        const customer = (customers ?? [])[0];
        if (customer && useCartStore.getState().pickedUpOrderId === order.id) {
          useCartStore.getState().attachCustomer({
            ...customer,
            category: (customer as { category?: unknown }).category ?? null,
          } as unknown as CustomerWithCategory);
        }
      } catch {
        // best-effort
      }

      toast.success(`Order ${order.order_number} loaded — take payment to settle`);
      void navigate('/pos');
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Could not load order');
    } finally {
      setIsLoading(false);
    }
  };

  return { loadDebtOrder, isLoading };
}
