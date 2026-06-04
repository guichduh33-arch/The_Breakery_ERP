import { useEffect } from 'react';
import { useCartStore } from '@/stores/cartStore';
import { calculateTotals } from '@breakery/domain';

const TAX_RATE = 0.10;
export const CART_CHANNEL = 'breakery-cart';

export interface CartBroadcastMessage {
  type: 'cart_update';
  cart: { items: unknown[]; order_type: string };
  totals: { subtotal: number; total: number; item_count: number };
  customer: { name: string } | null;
}

/** Mount on the POS side: mirrors the live cart to /display via BroadcastChannel. */
export function useCartBroadcast(): void {
  useEffect(() => {
    const bc = new BroadcastChannel(CART_CHANNEL);
    const publish = (): void => {
      const { cart, attachedCustomer } = useCartStore.getState();
      const totals = calculateTotals(cart, TAX_RATE);
      const msg: CartBroadcastMessage = {
        type: 'cart_update',
        cart: { items: cart.items, order_type: cart.order_type },
        totals: { subtotal: totals.subtotal, total: totals.total, item_count: totals.item_count },
        customer: attachedCustomer ? { name: attachedCustomer.name } : null,
      };
      bc.postMessage(msg);
    };
    publish(); // initial snapshot
    const unsub = useCartStore.subscribe(publish);
    return () => {
      unsub();
      bc.close();
    };
  }, []);
}
