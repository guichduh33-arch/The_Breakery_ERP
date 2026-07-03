import { useEffect } from 'react';
import { useCartStore } from '@/stores/cartStore';
import { calculateTotals, DEFAULT_TAX_RATE } from '@breakery/domain';
export const CART_CHANNEL = 'breakery-cart';

/** S57 C-D4 — how long the customer display shows the "Merci" / change screen
 *  after a successful checkout before it reverts to the welcome idle state. */
export const PAYMENT_COMPLETE_DISPLAY_MS = 8_000;

/** Live cart mirror pushed on every cart mutation (the nominal broadcast). */
export interface CartUpdateMessage {
  type: 'cart_update';
  cart: { items: unknown[]; order_type: string };
  totals: { subtotal: number; total: number; item_count: number };
  customer: { name: string } | null;
}

/** S57 C-D4 — one-shot broadcast emitted at checkout success so the customer
 *  display can confirm the sale (and the change to collect on cash). */
export interface PaymentCompleteMessage {
  type: 'payment_complete';
  total: number;
  /** Change to hand back; null / 0 for non-cash tenders (masked on screen). */
  change: number | null;
  method: string;
}

export type CartBroadcastMessage = CartUpdateMessage | PaymentCompleteMessage;

/** POS side: fire-and-forget a payment_complete snapshot to the customer
 *  display. Covers every tender path (fast-path AND split) because it is
 *  emitted from the shared SuccessModal that renders after any successful sale. */
export function broadcastPaymentComplete(
  payload: Omit<PaymentCompleteMessage, 'type'>,
): void {
  const bc = new BroadcastChannel(CART_CHANNEL);
  bc.postMessage({ type: 'payment_complete', ...payload } satisfies PaymentCompleteMessage);
  bc.close();
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
