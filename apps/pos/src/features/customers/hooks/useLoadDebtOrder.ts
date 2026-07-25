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
// Does NOT call `reopen_held_order_v1` or `pickup_tablet_order` — those gates
// don't apply to a plain counter ardoise (no held/tablet claim to make).
import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { toast } from 'sonner';
import { supabase } from '@/lib/supabase';
import { useCartStore } from '@/stores/cartStore';
import type { CartItem, OrderType } from '@breakery/domain';
import type { CustomerWithCategory } from './useCustomerSearch';
import type { OutstandingOrder } from './useOutstandingDebts';

interface OrderItemRow {
  id: string;
  product_id: string;
  // NB: the column is `name_snapshot` (frozen at order time) — there is no
  // `order_items.name`. Selecting `name` 42703s the whole load (silent in
  // mocked tests, fatal in prod).
  name_snapshot: string;
  unit_price: number;
  quantity: number;
  modifiers: unknown;
  is_cancelled: boolean;
}

function toCartItem(row: OrderItemRow): CartItem {
  return {
    id: row.id,
    product_id: row.product_id,
    name: row.name_snapshot,
    unit_price: row.unit_price,
    quantity: row.quantity,
    modifiers: (row.modifiers as CartItem['modifiers']) ?? [],
  };
}

export function useLoadDebtOrder() {
  const [isLoading, setIsLoading] = useState(false);
  const navigate = useNavigate();

  const loadDebtOrder = async (order: OutstandingOrder, customerId: string): Promise<void> => {
    const cartStore = useCartStore.getState();
    if (cartStore.cart.items.length > 0) {
      const confirmed = window.confirm('Replace the current cart with this unpaid order?');
      if (!confirmed) return;
    }

    setIsLoading(true);
    try {
      const { data, error } = await supabase
        .from('order_items')
        .select('id, product_id, name_snapshot, unit_price, quantity, modifiers, is_cancelled')
        .eq('order_id', order.id);
      if (error) throw new Error(error.message);

      const rows = (data ?? []) as unknown as OrderItemRow[];
      const liveRows = rows.filter((r) => !r.is_cancelled);
      if (liveRows.length === 0) throw new Error('No payable items on this order');

      const items = liveRows.map(toCartItem);
      const ids = items.map((i) => i.id);

      useCartStore.getState().restoreCart({
        items,
        order_type: order.order_type as OrderType,
      });
      useCartStore.getState().markLocked(ids);
      useCartStore.getState().markPrinted(ids);
      useCartStore.getState().setPickedUpOrderId(order.id);

      // Best-effort customer badge attach (pattern: useReopenHeldOrder) — a
      // lookup miss just leaves the badge absent, pricing already runs off
      // cart.customerId set indirectly via attachCustomer below.
      try {
        const { data: customers } = await supabase.rpc('get_customer_v3', { p_id: customerId });
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

      toast.success(`Order ${order.order_number} loaded — take payment to settle`);
      navigate('/pos');
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Could not load order');
    } finally {
      setIsLoading(false);
    }
  };

  return { loadDebtOrder, isLoading };
}
