// packages/domain/src/payment/validatePayment.ts
import type { PaymentInput } from '../types/index.js';

export type ValidationResult =
  | { ok: true }
  | { ok: false; error: 'amount_mismatch' | 'cash_received_required' | 'cash_received_insufficient' };

export function validatePayment(payment: PaymentInput, expectedTotal: number): ValidationResult {
  if (payment.amount !== expectedTotal) {
    return { ok: false, error: 'amount_mismatch' };
  }
  if (payment.method === 'cash') {
    if (payment.cash_received === undefined) {
      return { ok: false, error: 'cash_received_required' };
    }
    if (payment.cash_received < payment.amount) {
      return { ok: false, error: 'cash_received_insufficient' };
    }
  }
  return { ok: true };
}
