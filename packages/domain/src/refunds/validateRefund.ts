// packages/domain/src/refunds/validateRefund.ts
// Session 10 — pure validators for the partial-refund flow.
// All checks mirror refund_order_rpc's server checks. Server is authoritative.

import type { RefundLineDraft, RefundableItem, MethodLedgerEntry, RefundTender } from './types.js';
import { computeRefundLineAmount } from './computeRefund.js';

export type RefundValidation =
  | { ok: true; refund_total: number }
  | {
      ok: false;
      error:
        | 'no_lines'
        | 'no_tenders'
        | 'reason_too_short'
        | 'unknown_item'
        | 'item_cancelled'
        | 'qty_invalid'
        | 'qty_exceeds_remaining'
        | 'cap_exceeded'
        | 'tender_amount_invalid'
        | 'tender_method_overflow'
        | 'tender_sum_mismatch';
      detail?: string;
    };

export interface RefundValidateInput {
  draft_lines: readonly RefundLineDraft[];
  draft_tenders: readonly RefundTender[];
  reason: string;
  items_by_id: ReadonlyMap<string, RefundableItem>;
  order_total: number;
  prior_refunds_total: number;
  method_ledger: readonly MethodLedgerEntry[];
}

export function validateRefundDraft(input: RefundValidateInput): RefundValidation {
  if (input.draft_lines.length < 1) return { ok: false, error: 'no_lines' };
  if (input.draft_tenders.length < 1) return { ok: false, error: 'no_tenders' };
  if (!input.reason || input.reason.trim().length < 3) {
    return { ok: false, error: 'reason_too_short' };
  }

  let refund_total = 0;
  for (const d of input.draft_lines) {
    const it = input.items_by_id.get(d.order_item_id);
    if (!it) return { ok: false, error: 'unknown_item', detail: d.order_item_id };
    if (it.is_cancelled) return { ok: false, error: 'item_cancelled', detail: d.order_item_id };
    if (!Number.isFinite(d.qty) || d.qty <= 0) {
      return { ok: false, error: 'qty_invalid', detail: d.order_item_id };
    }
    const remaining = it.quantity - it.qty_already_refunded;
    if (d.qty > remaining) {
      return { ok: false, error: 'qty_exceeds_remaining', detail: `${d.order_item_id} max=${remaining}` };
    }
    refund_total += computeRefundLineAmount(it, d.qty);
  }

  if (input.prior_refunds_total + refund_total > input.order_total) {
    return {
      ok: false,
      error: 'cap_exceeded',
      detail: `prior=${input.prior_refunds_total} new=${refund_total} > order=${input.order_total}`,
    };
  }

  // Tender routing : per-method (paid - already_refunded) must cover the new tender.
  const ledgerByMethod = new Map(input.method_ledger.map((e) => [e.method, e]));
  let tender_sum = 0;
  for (const t of input.draft_tenders) {
    if (!Number.isFinite(t.amount) || t.amount <= 0) {
      return { ok: false, error: 'tender_amount_invalid', detail: t.method };
    }
    const ledger = ledgerByMethod.get(t.method);
    const remainingForMethod = ledger ? ledger.paid - ledger.refunded : 0;
    if (t.amount > remainingForMethod) {
      return {
        ok: false,
        error: 'tender_method_overflow',
        detail: `method=${t.method} avail=${remainingForMethod} requested=${t.amount}`,
      };
    }
    tender_sum += t.amount;
  }

  if (tender_sum !== refund_total) {
    return { ok: false, error: 'tender_sum_mismatch', detail: `tenders=${tender_sum} refund=${refund_total}` };
  }

  return { ok: true, refund_total };
}
