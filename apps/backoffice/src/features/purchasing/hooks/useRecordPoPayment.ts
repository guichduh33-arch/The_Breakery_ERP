// apps/backoffice/src/features/purchasing/hooks/useRecordPoPayment.ts
//
// Session 46 — R3: records a supplier payment against a PO via record_po_payment_v2.
// Gated server-side by purchasing.po.pay. Idempotency flavor 2 (S25): the client
// generates a UUID v4 per dialog session and reuses it across retries.
//
// Bumped to v2 (20260821000002) — v1 had no guard against a `cancelled` PO;
// v2 raises `po_cancelled` (P0001) before delegating to the payment helper.

import { useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/lib/supabase.js';
import { PO_PAYMENTS_QUERY_KEY } from './usePoPayments.js';
import { PURCHASE_ORDER_DETAIL_QUERY_KEY } from './usePurchaseOrderDetail.js';
import { PURCHASE_ORDERS_QUERY_KEY } from './usePurchaseOrdersList.js';

export type RecordPaymentErrorCode =
  | 'forbidden'
  | 'po_not_found'
  | 'amount_must_be_positive'
  | 'overpayment_not_allowed'
  | 'invalid_method'
  | 'po_cancelled'
  | 'unknown';

export class RecordPaymentError extends Error {
  constructor(public code: RecordPaymentErrorCode, message?: string) {
    super(message ?? code);
    this.name = 'RecordPaymentError';
  }
}

export type PoPaymentMethod = 'cash' | 'transfer' | 'card' | 'qris' | 'edc';

export interface RecordPaymentArgs {
  poId:           string;
  amount:         number;
  method:         PoPaymentMethod;
  reference?:     string;
  idempotencyKey: string;   // UUID v4, stable across retries (caller owns it)
}

export interface RecordPaymentResult {
  payment_id:        string;
  je_id:             string | null;
  amount_paid:       number;
  total_paid:        number;
  remaining_due:     number;
  derived_status:    'unpaid' | 'partial' | 'paid';
  idempotent_replay: boolean;
}

function classify(message: string): RecordPaymentErrorCode {
  if (message.includes('forbidden') || message.includes('permission_denied')) return 'forbidden';
  if (message.includes('po_not_found'))            return 'po_not_found';
  if (message.includes('amount_must_be_positive')) return 'amount_must_be_positive';
  if (message.includes('overpayment'))             return 'overpayment_not_allowed';
  if (message.includes('invalid_method'))          return 'invalid_method';
  if (message.includes('po_cancelled'))            return 'po_cancelled';
  return 'unknown';
}

/**
 * Friendly override for codes whose raw Postgres message should not reach the
 * UI as-is. `classify` only maps text → code; without this, a caller that
 * renders `error.message` directly would show the bare server string.
 */
function friendlyMessage(code: RecordPaymentErrorCode, raw: string): string {
  if (code === 'po_cancelled') {
    return 'This purchase order is cancelled — no payment can be recorded.';
  }
  return raw;
}

export function useRecordPoPayment() {
  const qc = useQueryClient();
  return useMutation<RecordPaymentResult, RecordPaymentError, RecordPaymentArgs>({
    mutationFn: async (args) => {
      const { data, error } = await supabase.rpc('record_po_payment_v2', {
        p_po_id:           args.poId,
        p_amount:          args.amount,
        p_method:          args.method,
        p_idempotency_key: args.idempotencyKey,
        ...(args.reference !== undefined && args.reference.trim() !== ''
          ? { p_reference: args.reference.trim() }
          : {}),
      });
      if (error !== null) {
        const code = classify(error.message);
        throw new RecordPaymentError(code, friendlyMessage(code, error.message));
      }
      if (data === null)  throw new RecordPaymentError('unknown', 'Empty RPC response');
      return data as unknown as RecordPaymentResult;
    },
    onSuccess: async (_data, vars) => {
      await Promise.all([
        qc.invalidateQueries({ queryKey: [...PO_PAYMENTS_QUERY_KEY, vars.poId] }),
        qc.invalidateQueries({ queryKey: [...PURCHASE_ORDER_DETAIL_QUERY_KEY, vars.poId] }),
        qc.invalidateQueries({ queryKey: PURCHASE_ORDERS_QUERY_KEY }),
      ]);
    },
  });
}
