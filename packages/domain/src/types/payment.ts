// packages/domain/src/types/payment.ts
export type PaymentMethod = 'cash' | 'card' | 'qris' | 'edc' | 'transfer' | 'store_credit';

export interface PaymentInput {
  method: PaymentMethod;
  amount: number;
  cash_received?: number;
  change_given?: number;
  reference?: string;
}

/**
 * Session 10 — alias of PaymentInput used to disambiguate single-tender payment
 * (legacy v7 single PaymentInput) from the multi-tender array (v8 Tender[]).
 * Identical shape — same DB column mapping.
 */
export type Tender = PaymentInput;

export interface PaymentResult {
  ok: true;
  order_id: string;
  order_number: string;
  total: number;
  tax_amount: number;
  change_given: number | null;
  // S44 D4 — loyalty figures come from the server envelope (the DB resolves the
  // tier × category multiplier). The receipt/success modal display these instead
  // of recomputing client-side. `loyalty_balance_after` is present on the direct
  // (EF/v12) path ; the pickup (v8) path returns points_earned only.
  loyalty_points_earned?: number;
  loyalty_balance_after?: number;
}

export interface PaymentError {
  ok: false;
  error: string;
  message?: string;
}
