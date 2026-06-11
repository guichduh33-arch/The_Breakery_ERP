// apps/pos/src/features/cart/hooks/useVoidServerOrder.ts
//
// Session 37 B4 — server-side void for tablet pickup orders that have been
// sent to kitchen. A tablet pickup cart (pickedUpOrderId !== null) has a server
// orders row created by create_tablet_order_v2; if the cashier sends items and
// then voids before checkout, the server row must be voided too.
//
// Counter orders (no pickedUpOrderId) do NOT have a server row before checkout —
// useFireToStations is print-only (no INSERT into orders). Client-only void is
// correct for those.
//
// This hook wraps the same void-order EF contract used by the order-history
// panel (PIN in x-manager-pin header, S34 pattern).

import { useVoidOrder } from '@/features/order-history/hooks/useVoidOrder';
import { useCartStore } from '@/stores/cartStore';

/**
 * Returns a function that:
 *  - If the cart has a server-side order (pickedUpOrderId) → calls the
 *    void-order EF (PIN required) then resets the cart on success.
 *  - If the cart is a plain counter cart (no pickedUpOrderId) → does a
 *    client-only void (same as before B4).
 *
 * The returned fn is async; callers should await it.
 */
export function useVoidServerOrder() {
  const voidOrderMutation = useVoidOrder();
  const voidLocal = useCartStore((s) => s.voidOrder);

  return async (managerPin: string): Promise<void> => {
    const { pickedUpOrderId } = useCartStore.getState();

    if (pickedUpOrderId) {
      // Tablet pickup: server row exists → void it first.
      await voidOrderMutation.mutateAsync({
        orderId: pickedUpOrderId,
        reason: 'Voided by manager at POS',
        managerPin,
      });
      // Only reset local state if the server call succeeded (exception would
      // propagate to the caller otherwise).
      voidLocal();
    } else {
      // Counter cart: no server row before checkout → client-only void.
      voidLocal();
    }
  };
}
