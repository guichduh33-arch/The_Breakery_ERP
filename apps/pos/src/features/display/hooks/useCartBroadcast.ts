import { useEffect } from 'react';
import { useCartStore } from '@/stores/cartStore';
import { calculateTotals, DEFAULT_TAX_RATE } from '@breakery/domain';
import { roundIdr } from '@breakery/utils';
export const CART_CHANNEL = 'breakery-cart';

/** S57 C-D4 — how long the customer display shows the "Merci" / change screen
 *  after a successful checkout before it reverts to the welcome idle state. */
export const PAYMENT_COMPLETE_DISPLAY_MS = 8_000;

/** Live cart mirror pushed on every cart mutation (the nominal broadcast). */
export interface CartUpdateMessage {
  type: 'cart_update';
  cart: { items: unknown[]; order_type: string };
  /** `tax_amount` is the PB1 tax extracted from the (post-promo) total at the
   *  server rate — informational "Tax included" line on the display. */
  totals: { subtotal: number; total: number; tax_amount: number; item_count: number };
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
  /** Server-authoritative tax included in `total` (receipt parity). */
  tax_amount: number;
  /** Attached customer's name; null for anonymous sales. */
  customer_name: string | null;
  /** Loyalty points earned on this sale; null when no customer / no points. */
  points_earned: number | null;
  /** Post-sale loyalty balance; null when the RPC doesn't expose it. */
  loyalty_balance_after: number | null;
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

/**
 * Mount on the POS side: mirrors the live cart to /display via BroadcastChannel.
 *
 * `taxRate` is the server rate from `useTaxRate()` — passed as a parameter
 * (rather than read via useQuery here) so the hook stays mountable without a
 * QueryClient in tests. It only feeds the informational `tax_amount` line;
 * every broadcast money figure is tax-INCLUSIVE and rate-independent.
 */
export function useCartBroadcast(taxRate: number = DEFAULT_TAX_RATE): void {
  useEffect(() => {
    const bc = new BroadcastChannel(CART_CHANNEL);
    const publish = (): void => {
      const { cart, attachedCustomer, appliedPromotions } = useCartStore.getState();
      const baseTotals = calculateTotals(cart, taxRate);
      // Mirror the amount-due computation from usePaymentFlowLogic (source of truth
      // for what the customer owes): deduct applied promotions on top of what
      // calculateTotals already handles (cartDiscount, line discounts, redemption).
      const promotionTotal = appliedPromotions.reduce((s, ap) => s + ap.amount, 0);
      const total = Math.max(0, baseTotals.total - promotionTotal);
      // PB1 — tax is extracted FROM the (promo-adjusted) total, not added on
      // top; same formula as calculateTotals but on the amount actually due.
      const tax_amount = roundIdr((total * taxRate) / (1 + taxRate));
      const msg: CartBroadcastMessage = {
        type: 'cart_update',
        cart: { items: cart.items, order_type: cart.order_type },
        totals: { subtotal: baseTotals.subtotal, total, tax_amount, item_count: baseTotals.item_count },
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
  }, [taxRate]);
}
