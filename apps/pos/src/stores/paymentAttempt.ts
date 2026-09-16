import type { AppliedPromotion, Cart, Tender } from '@breakery/domain';
import type { PaymentSuccessState } from '@/features/payment/hooks/paymentSuccess';
import type { CustomerWithCategory } from './cartStore';

export interface CheckoutContext {
  idempotencyKey: string;
  appendUuid: string;
  sessionId: string;
  userId: string;
  pickedUpOrderId: string | null;
  orderOrigin: 'pos' | 'tablet' | null;
  lockedItemIds: string[];
  printedItemIds: string[];
  appliedPromotions: AppliedPromotion[];
  appendDiscountAuthId?: string;
  paymentDiscountAuthId?: string;
  sourceCode?: string | null;
  offlineOrder?: { clientUuid: string; localNumber: string } | null;
}

export interface PaymentAttempt {
  version: 1;
  result?: PaymentSuccessState;
  successEffectsStarted?: boolean;
  state: 'pending' | 'unknown' | 'confirmed' | 'refused';
  cart: Cart;
  tenders: Tender[];
  context: CheckoutContext;
  customer: CustomerWithCategory | null;
  offline: boolean;
  taxRate: number;
  taxInclusive: boolean;
}

const KEY = 'breakery.payment-attempt.v1';

/** L'écriture précède l'appel réseau ; un stockage plein interdit le départ. */
export function savePaymentAttempt(attempt: PaymentAttempt | null): void {
  if (attempt) localStorage.setItem(KEY, JSON.stringify(attempt));
  else localStorage.removeItem(KEY);
}

export function readPaymentAttempt(): PaymentAttempt | null {
  const raw = localStorage.getItem(KEY);
  if (!raw) return null;
  const value = JSON.parse(raw) as PaymentAttempt;
  if (value.version !== 1 || !value.context?.idempotencyKey || !Array.isArray(value.cart?.items)
    || !Array.isArray(value.tenders)) throw new Error('Unrecognized saved payment — contact a manager');
  // Après redémarrage, un appel en vol a un résultat inconnu, jamais un échec certain.
  return { ...value, state: value.state === 'pending' ? 'unknown' : value.state };
}
