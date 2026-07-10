// apps/pos/src/features/cart/hooks/useVoidServerOrder.ts
//
// Session 37 B4 — server-side void for carts backed by a server orders row.
//
// S43 P0-3 update: useFireToStations now PERSISTS counter fires via
// fire_counter_order_v1 (create/append) and sets pickedUpOrderId — so a FIRED
// counter order has a server row and routes through the void-order EF exactly
// like a tablet pickup (create_tablet_order_v2). Only a never-fired cart
// (pickedUpOrderId === null, nothing persisted) is voided client-side.
//
// This hook wraps the same void-order EF contract used by the order-history
// panel (PIN in x-manager-pin header, S34 pattern).

import { useVoidOrder } from '@/features/order-history/hooks/useVoidOrder';
import { useCartStore } from '@/stores/cartStore';

/**
 * Returns a function that:
 *  - If the cart has a server-side order (pickedUpOrderId — tablet pickup or
 *    fired counter order) → calls the void-order EF (PIN required) then
 *    resets the cart on success.
 *  - If the cart was never fired (no pickedUpOrderId) → does a client-only
 *    void (same as before B4).
 *
 * The returned fn is async; callers should await it.
 */
export function useVoidServerOrder() {
  const voidOrderMutation = useVoidOrder();
  const voidLocal = useCartStore((s) => s.voidOrder);

  return async (managerPin: string, reason: string, idempotencyKey?: string): Promise<void> => {
    const { pickedUpOrderId } = useCartStore.getState();

    if (pickedUpOrderId) {
      // Server row exists (tablet pickup OR fired counter order) → void it first.
      await voidOrderMutation.mutateAsync({
        orderId: pickedUpOrderId,
        reason,
        managerPin,
        // exactOptionalPropertyTypes: omit the key entirely when absent rather
        // than passing `undefined` into the optional VoidArgs.idempotencyKey.
        ...(idempotencyKey ? { idempotencyKey } : {}),
      });
      // Only reset local state if the server call succeeded (exception would
      // propagate to the caller otherwise).
      voidLocal();
    } else {
      // Never-fired cart: nothing persisted yet → client-only void.
      voidLocal();
    }
  };
}
