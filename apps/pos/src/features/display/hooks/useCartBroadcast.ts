import { useEffect } from 'react';
import { useCartStore } from '@/stores/cartStore';
import { calculateTotals, splitPb1, DEFAULT_TAX_RATE } from '@breakery/domain';
export const CART_CHANNEL = 'breakery-cart';

/** S57 C-D4 — how long the customer display shows the "Merci" / change screen
 *  after a successful checkout before it reverts to the welcome idle state. */
export const PAYMENT_COMPLETE_DISPLAY_MS = 8_000;

/** Live cart mirror pushed on every cart mutation (the nominal broadcast). */
export interface CartUpdateMessage {
  type: 'cart_update';
  cart: { items: unknown[]; order_type: string };
  /** `tax_amount` is the PB1 share of the (post-promo) total at the server
   *  config — informational tax line on the display. `tax_inclusive` mirrors
   *  business_config (Lot 6b) so the display labels it correctly. */
  totals: { subtotal: number; total: number; tax_amount: number; item_count: number; tax_inclusive: boolean };
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
  /** Server-authoritative PB1 share of `total` (receipt parity). */
  tax_amount: number;
  /** Global tax mode at checkout time — labels the display's tax line (Lot 6b). */
  tax_inclusive: boolean;
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
 * `taxRate` / `taxInclusive` come from `useTaxConfig()` — passed as parameters
 * (rather than read via useQuery here) so the hook stays mountable without a
 * QueryClient in tests. They feed the informational tax line and its label;
 * the split mirrors `_pb1_split_v1` on the amount actually due.
 */
export function useCartBroadcast(
  taxRate: number = DEFAULT_TAX_RATE,
  taxInclusive = true,
): void {
  useEffect(() => {
    const bc = new BroadcastChannel(CART_CHANNEL);
    const publish = (): void => {
      const { cart, attachedCustomer, appliedPromotions } = useCartStore.getState();
      // calculateTotals runs inclusive (default) so `total` stays the pre-tax
      // base whatever the mode; promos are deducted on top (mirror of
      // usePaymentFlowLogic, source of truth for what the customer owes), then
      // the PB1 split is applied ONCE via splitPb1.
      const baseTotals = calculateTotals(cart, taxRate);
      const promotionTotal = appliedPromotions.reduce((s, ap) => s + ap.amount, 0);
      const { tax_amount, total } = splitPb1(
        Math.max(0, baseTotals.total - promotionTotal), taxRate, taxInclusive,
      );
      const msg: CartBroadcastMessage = {
        type: 'cart_update',
        cart: { items: cart.items, order_type: cart.order_type },
        totals: {
          subtotal: baseTotals.subtotal,
          total,
          tax_amount,
          item_count: baseTotals.item_count,
          tax_inclusive: taxInclusive,
        },
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
  }, [taxRate, taxInclusive]);
}
