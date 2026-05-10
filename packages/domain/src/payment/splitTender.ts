// packages/domain/src/payment/splitTender.ts
// Session 10 — pure validators + computers for multi-tender (split payment) flow.
// Server (RPC v8) re-validates the same rules; this is the client-side gate.

import type { Tender } from '../types/index.js';

export const MAX_TENDERS = 5;

export function sumTenders(tenders: readonly Tender[]): number {
  let s = 0;
  for (const t of tenders) s += t.amount;
  return s;
}

export function computeRemaining(total: number, tenders: readonly Tender[]): number {
  return Math.max(0, total - sumTenders(tenders));
}

/**
 * SP2 rule: only the LAST tender may have cash_received > amount (i.e., generate change).
 * Intermediate tenders may have cash_received === amount (or undefined for non-cash).
 */
export function isLastTenderCashOverpayAllowed(tenders: readonly Tender[], idx: number): boolean {
  return idx === tenders.length - 1;
}

export type SplitValidation =
  | { ok: true }
  | { ok: false; error: 'no_tenders' | 'too_many_tenders' | 'sum_mismatch' | 'tender_amount_invalid' | 'intermediate_cash_overpay'; detail?: string };

export function validateTenders(total: number, tenders: readonly Tender[]): SplitValidation {
  if (tenders.length < 1) return { ok: false, error: 'no_tenders' };
  if (tenders.length > MAX_TENDERS) {
    return { ok: false, error: 'too_many_tenders', detail: `max ${MAX_TENDERS}` };
  }

  let sum = 0;
  for (let i = 0; i < tenders.length; i++) {
    const t = tenders[i]!;
    if (!Number.isFinite(t.amount) || t.amount <= 0) {
      return { ok: false, error: 'tender_amount_invalid', detail: `tender ${i + 1}` };
    }
    if (
      t.method === 'cash'
      && t.cash_received !== undefined
      && t.cash_received > t.amount
      && i < tenders.length - 1
    ) {
      return {
        ok: false,
        error: 'intermediate_cash_overpay',
        detail: `tender ${i + 1}: cash_received cannot exceed amount on intermediate tenders`,
      };
    }
    sum += t.amount;
  }

  if (sum !== total) {
    return { ok: false, error: 'sum_mismatch', detail: `sum=${sum} total=${total}` };
  }

  return { ok: true };
}
