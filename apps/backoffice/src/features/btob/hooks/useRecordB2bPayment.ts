// apps/backoffice/src/features/btob/hooks/useRecordB2bPayment.ts
//
// Session 24 / Phase 2.A.4 — call record_b2b_payment_v2 (S52 migration _067).
//
// Records a payment received from a B2B customer. The RPC emits the JE
// (DR Cash/Bank / CR B2B_AR), inserts a b2b_payments row + real per-invoice
// allocation rows (b2b_payment_allocations), sets orders.paid_at on full
// settlement, decrements the customer's cached balance, and records an
// audit_logs. Idempotent. Optional invoiceIds → targeted allocation (array
// order), else FIFO over the oldest unpaid invoices.

import { useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/lib/supabase.js';
import { B2B_DASHBOARD_QUERY_KEY } from './useB2bDashboard.js';
import { B2B_PAYMENTS_RECEIVED_QUERY_KEY } from './useB2bPaymentsReceived.js';
import { B2B_CUSTOMERS_QUERY_KEY } from './useB2bCustomers.js';

export type RecordB2bPaymentErrorCode =
  | 'not_authenticated'
  | 'permission_denied'
  | 'customer_not_found'
  | 'customer_not_b2b'
  | 'invalid_amount'
  | 'overpayment_not_allowed'
  | 'fiscal_period_closed'
  | 'unknown';

export class RecordB2bPaymentError extends Error {
  constructor(public code: RecordB2bPaymentErrorCode, message?: string) {
    super(message ?? code);
    this.name = 'RecordB2bPaymentError';
  }
}

export type B2bPaymentMethod = 'cash' | 'card' | 'qris' | 'transfer' | 'edc' | 'store_credit';

export interface RecordB2bPaymentArgs {
  customerId:      string;
  amount:          number;
  method:          B2bPaymentMethod;
  reference?:      string;
  paidAt?:         string;          // ISO datetime
  notes?:          string;
  idempotencyKey:  string;
  invoiceIds?:     string[];        // optional targeted allocation (array order), else FIFO
}

export interface RecordB2bPaymentResult {
  payment_id:             string;
  payment_number:         string;
  allocations:            Array<{ invoice_id: string; amount_applied: number; fully_settled: boolean }>;
  allocation:             Array<{ invoice_id: string; amount_applied: number; fully_settled?: boolean }>;
  je_id:                  string;
  customer_balance_after: number;
  idempotent_replay:      boolean;
}

export function classify(message: string): RecordB2bPaymentErrorCode {
  if (message.includes('overpayment_not_allowed')) return 'overpayment_not_allowed';
  if (message.includes('customer_not_b2b'))        return 'customer_not_b2b';
  if (message.includes('customer_not_found'))      return 'customer_not_found';
  if (message.includes('invalid_amount'))          return 'invalid_amount';
  if (message.includes('permission_denied'))       return 'permission_denied';
  if (message.includes('not_authenticated'))       return 'not_authenticated';
  if (message.includes('fiscal_period'))           return 'fiscal_period_closed';
  // S54 fail-closed guard: 'period_undefined: no fiscal period covers <date>'
  if (message.includes('period_undefined') || message.includes('no fiscal period')) {
    return 'fiscal_period_closed';
  }
  return 'unknown';
}

export function useRecordB2bPayment() {
  const qc = useQueryClient();
  return useMutation<RecordB2bPaymentResult, RecordB2bPaymentError, RecordB2bPaymentArgs>({
    mutationFn: async (args) => {
      const rpcArgs: {
        p_customer_id:     string;
        p_amount:          number;
        p_method:          B2bPaymentMethod;
        p_reference?:      string;
        p_paid_at?:        string;
        p_notes?:          string;
        p_idempotency_key: string;
        p_invoice_ids?:    string[];
      } = {
        p_customer_id:     args.customerId,
        p_amount:          args.amount,
        p_method:          args.method,
        p_idempotency_key: args.idempotencyKey,
      };
      if (args.reference !== undefined && args.reference.trim() !== '') rpcArgs.p_reference = args.reference.trim();
      if (args.paidAt    !== undefined && args.paidAt    !== '')        rpcArgs.p_paid_at   = args.paidAt;
      if (args.notes     !== undefined && args.notes.trim() !== '')     rpcArgs.p_notes     = args.notes.trim();
      if (args.invoiceIds !== undefined && args.invoiceIds.length > 0)  rpcArgs.p_invoice_ids = args.invoiceIds;

      const { data, error } = await supabase.rpc('record_b2b_payment_v2', rpcArgs);
      if (error) throw new RecordB2bPaymentError(classify(error.message), error.message);
      if (data === null) throw new RecordB2bPaymentError('unknown', 'Empty RPC response');
      return data as unknown as RecordB2bPaymentResult;
    },
    onSuccess: async () => {
      await Promise.all([
        qc.invalidateQueries({ queryKey: B2B_DASHBOARD_QUERY_KEY }),
        qc.invalidateQueries({ queryKey: B2B_PAYMENTS_RECEIVED_QUERY_KEY }),
        qc.invalidateQueries({ queryKey: B2B_CUSTOMERS_QUERY_KEY }),
        qc.invalidateQueries({ queryKey: ['customers'] }),
        qc.invalidateQueries({ queryKey: ['b2b-invoices'] }),
      ]);
    },
  });
}
