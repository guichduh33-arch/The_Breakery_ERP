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
      // S51 — the broadcast carries only subtotal/total/item_count, all of which
      // are tax-INCLUSIVE and therefore rate-independent (calculateTotals derives
      // tax FROM the total — only `tax_amount`, which we don't broadcast, varies
      // with the rate). The customer display has no tax line, so DEFAULT_TAX_RATE
      // here is inert; we keep the constant rather than couple this display mirror
      // to a business_config network read for zero functional benefit.
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
