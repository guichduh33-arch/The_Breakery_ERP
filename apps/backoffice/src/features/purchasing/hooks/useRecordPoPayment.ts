// apps/backoffice/src/features/purchasing/hooks/useRecordPoPayment.ts
//
// Session 46 — R3: records a supplier payment against a PO via record_po_payment_v1.
// Gated server-side by purchasing.po.pay. Idempotency flavor 2 (S25): the client
// generates a UUID v4 per dialog session and reuses it across retries.

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
  return 'unknown';
}

export function useRecordPoPayment() {
  const qc = useQueryClient();
  return useMutation<RecordPaymentResult, RecordPaymentError, RecordPaymentArgs>({
    mutationFn: async (args) => {
      const { data, error } = await supabase.rpc('record_po_payment_v1', {
        p_po_id:           args.poId,
        p_amount:          args.amount,
        p_method:          args.method,
        p_idempotency_key: args.idempotencyKey,
        ...(args.reference !== undefined && args.reference.trim() !== ''
          ? { p_reference: args.reference.trim() }
          : {}),
      });
      if (error !== null) throw new RecordPaymentError(classify(error.message), error.message);
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
