// packages/domain/src/refunds/types.ts
// Session 10 — refund domain types.

import type { PaymentMethod } from '../types/index.js';

/** Information needed for the partial-refund cap check on a single order_item. */
export interface RefundableItem {
  order_item_id: string;
  quantity: number;       // original line qty
  line_total: number;     // original line_total (post line-discount)
  qty_already_refunded: number;
  is_cancelled: boolean;
}

/** A line the cashier wants to refund: original item + qty to return. */
export interface RefundLineDraft {
  order_item_id: string;
  qty: number;
}

/** A refund tender row. */
export interface RefundTender {
  method: PaymentMethod;
  amount: number;
  reference?: string;
}

/** Per-method paid + already refunded snapshot for tender routing. */
export interface MethodLedgerEntry {
  method: PaymentMethod;
  paid: number;        // sum of order_payments.amount for this method
  refunded: number;    // sum of refund_payments.amount for this method (across all refunds on this order)
}

/** Full refund draft as the cashier composes it. */
export interface RefundDraft {
  order_id: string;
  lines: RefundLineDraft[];
  tenders: RefundTender[];
  reason: string;
}
