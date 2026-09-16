import type { AppliedPromotion, PaymentMethod, PaymentResultLine } from '@breakery/domain';
export interface PaymentSuccessState {
  orderNumber: string;
  orderId?: string;
  total: number;
  // S51 — server-authoritative tax + per-line breakdown (money-path v15). The
  // receipt consumes these instead of recomputing client-side. `taxAmount` falls
  // back to the pre-payment estimate only if the server omitted it.
  taxAmount: number;
  subtotal?: number;
  lines?: PaymentResultLine[];
  changeGiven: number | null;
  pointsEarned: number;
  // S44 D4 — server-resolved loyalty balance (direct/EF path only).
  loyaltyBalanceAfter?: number;
  customerName: string | undefined;
  paymentMethod: PaymentMethod;
  // Session 60 (fiche 13 D1.1) — snapshot of cartStore.appliedPromotions at the
  // moment of success, so the receipt shows named promo lines without reading
  // the store directly (parity with the other frozen PaymentSuccessState fields).
  appliedPromotions?: AppliedPromotion[];
  // Critique 2026-08-14 P1 — encaissement mis en file offline (outbox), pas
  // confirmé serveur : le SuccessModal rend la variante ambre « recorded ».
  offline?: boolean;
  // Critique 2026-08-29 P3 — cash réellement reçu, sommé sur les règlements
  // expédiés (le brouillon cashReceivedStr est périmé/vide sur un split).
  cashReceived?: number;
}
