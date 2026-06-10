import { useEffect } from 'react';
import { useCartStore } from '@/stores/cartStore';
import { calculateTotals, DEFAULT_TAX_RATE } from '@breakery/domain';
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
      const { cart, attachedCustomer, appliedPromotions } = useCartStore.getState();
      const baseTotals = calculateTotals(cart, DEFAULT_TAX_RATE);
      // Mirror the amount-due computation from usePaymentFlowLogic (source of truth
      // for what the customer owes): deduct applied promotions on top of what
      // calculateTotals already handles (cartDiscount, line discounts, redemption).
      const promotionTotal = appliedPromotions.reduce((s, ap) => s + ap.amount, 0);
      const total = Math.max(0, baseTotals.total - promotionTotal);
      const msg: CartBroadcastMessage = {
        type: 'cart_update',
        cart: { items: cart.items, order_type: cart.order_type },
        totals: { subtotal: baseTotals.subtotal, total, item_count: baseTotals.item_count },
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
