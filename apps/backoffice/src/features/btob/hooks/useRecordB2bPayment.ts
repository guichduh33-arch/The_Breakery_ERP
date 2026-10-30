// apps/backoffice/src/features/btob/hooks/useRecordB2bPayment.ts
//
// Session 24 / Phase 2.A.4 — call la famille record_b2b_payment (règlement par avoir inclus).
//
// Records a payment received from a B2B customer. The RPC emits the JE
// (DR Cash/Bank/Store Credit / CR B2B_AR), inserts a b2b_payments row + real per-invoice
// allocation rows (b2b_payment_allocations), sets orders.paid_at on full
// settlement, decrements the customer's cached balance, and records an
// audit_logs. Idempotent. Optional invoiceIds → targeted allocation (array
// order), puis FIFO du reliquat sur toute facture non-voidée encore ouverte.
//
// Règle de refus (migration 20260901000006) : un reliquat qu'aucune facture ne
// peut absorber fait ÉCHOUER l'appel entier (SQLSTATE P0011,
// `payment_not_fully_allocated (unallocated: X, amount: Y)`) — rien n'est
// enregistré, ni paiement ni JE. La version précédente laissait tomber ce
// reliquat en silence. Le payload porte désormais `allocated_total` et
// `unallocated` (0 en succès ; sur replay idempotent, recalculé depuis le
// ledger d'allocation et donc possiblement > 0 pour un paiement historique).

import { useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/lib/supabase.js';
import { B2B_DASHBOARD_QUERY_KEY } from './useB2bDashboard.js';
import { B2B_PAYMENTS_RECEIVED_QUERY_KEY } from './useB2bPaymentsReceived.js';
import { B2B_CUSTOMERS_QUERY_KEY } from './useB2bCustomers.js';
import { storeCreditHistoryKey } from '../../customers/hooks/useStoreCreditHistory.js';
import { FinancialAttemptError } from '@/lib/pendingFinancialAttempts.js';
import { finite, identifier, isRecord } from '@/lib/pendingFinancialAttemptSchema.js';
import { captureFinancialSession } from '@/lib/useFinancialAttempt.js';

export type RecordB2bPaymentErrorCode =
  | 'not_authenticated'
  | 'permission_denied'
  | 'customer_not_found'
  | 'customer_not_b2b'
  | 'invalid_amount'
  | 'insufficient_store_credit'
  | 'overpayment_not_allowed'
  | 'payment_not_fully_allocated'
  | 'fiscal_period_closed'
  | 'unknown';

export class RecordB2bPaymentError extends FinancialAttemptError {
  constructor(public code: RecordB2bPaymentErrorCode, message?: string, definitive = false) {
    super(message ?? code, definitive);
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
  sessionGuard?:   () => boolean;
}

export interface RecordB2bPaymentResult {
  payment_id:             string;
  payment_number:         string;
  allocations:            { invoice_id: string; amount_applied: number; fully_settled?: boolean }[];
  allocation:             { invoice_id: string; amount_applied: number; fully_settled?: boolean }[];
  je_id:                  string;
  customer_balance_after: number;
  allocated_total:        number;
  unallocated:            number;
  idempotent_replay:      boolean;
}

export function classify(message: string): RecordB2bPaymentErrorCode {
  if (message.includes('Insufficient store credit balance')) return 'insufficient_store_credit';
  if (message.includes('overpayment_not_allowed')) return 'overpayment_not_allowed';
  if (message.includes('payment_not_fully_allocated')) return 'payment_not_fully_allocated';
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
  return useMutation({
    retry: false,
    meta: { errorHandled: true },
    onMutate: () => captureFinancialSession(),
    mutationFn: async (args: RecordB2bPaymentArgs): Promise<RecordB2bPaymentResult> => {
      const session = captureFinancialSession();
      const assertSession = () => {
        if (!session.current() || args.sessionGuard?.() === false) {
          throw new RecordB2bPaymentError('unknown', 'Your session changed. Reopen this form.');
        }
      };
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

      assertSession();
      const { data, error } = await supabase.rpc('record_b2b_payment_v5', rpcArgs);
      assertSession();
      if (error) throw new RecordB2bPaymentError(classify(error.message), error.message,
        paymentDefinitiveFailure(error.code, error.message));
      if (!validPaymentResult(data, args.amount)) throw new RecordB2bPaymentError('unknown', 'The payment response was invalid. Its result is unconfirmed.');
      // Une enveloppe valide ne prouve pas que le paiement appartient à cette tentative.
      // Le ledger immuable lie la clé, le client et les montants avant résolution durable.
      assertSession();
      const payment = await supabase.from('b2b_payments')
        .select('id,customer_id,idempotency_key,amount,method,payment_number,journal_entry_id')
        .eq('id', data.payment_id).maybeSingle();
      assertSession();
      if (payment.error || !isRecord(payment.data) || payment.data.id !== data.payment_id
        || payment.data.customer_id !== args.customerId || payment.data.idempotency_key !== args.idempotencyKey
        || payment.data.amount !== args.amount || payment.data.method !== args.method
        || payment.data.payment_number !== data.payment_number || payment.data.journal_entry_id !== data.je_id) {
        throw new RecordB2bPaymentError('unknown', 'The payment ledger could not confirm this attempt. Its result is unconfirmed.');
      }
      return data;
    },
    onSuccess: async (_data, args, session) => {
      if (!session?.current() || args.sessionGuard?.() === false) return;
      await Promise.all([
        qc.invalidateQueries({ queryKey: B2B_DASHBOARD_QUERY_KEY }),
        qc.invalidateQueries({ queryKey: B2B_PAYMENTS_RECEIVED_QUERY_KEY }),
        qc.invalidateQueries({ queryKey: B2B_CUSTOMERS_QUERY_KEY }),
        qc.invalidateQueries({ queryKey: ['customers'] }),
        qc.invalidateQueries({ queryKey: ['customer-detail', args.customerId] }),
        qc.invalidateQueries({ queryKey: storeCreditHistoryKey(args.customerId) }),
        qc.invalidateQueries({ queryKey: ['b2b-invoices'] }),
      ]);
    },
  });
}

/** Pas de classement définitif sur texte seul : le SQLSTATE doit correspondre. */
export function paymentDefinitiveFailure(code: string, message: string): boolean {
  const rules: Record<string, RegExp> = {
    P0001: /^(not_authenticated|user_profile_not_found|invalid_amount|customer_not_b2b|invalid_target_invoice|target_invoice_already_settled)(?:$|:)/,
    P0002: /^customer_not_found$/,
    P0003: /^permission_denied: b2b\.payment\.record$/,
    P0004: /^(fiscal_period_closed|period_undefined)(?:$|:)/,
    P0011: /^(overpayment_not_allowed|payment_not_fully_allocated) \(/,
    P0016: /^Insufficient store credit balance \(/,
  };
  return rules[code]?.test(message) === true;
}

export function validPaymentResult(data: unknown, amount: number): data is RecordB2bPaymentResult {
  if (!isRecord(data) || !identifier(data.payment_id) || !identifier(data.payment_number)
    || !identifier(data.je_id) || !finite(data.customer_balance_after) || data.customer_balance_after < 0
    || !finite(data.allocated_total) || data.allocated_total < 0
    || !finite(data.unallocated) || data.unallocated < 0 || typeof data.idempotent_replay !== 'boolean'
    || (!data.idempotent_replay && data.unallocated !== 0)) return false;
  const validAllocation = (value: unknown) => isRecord(value) && identifier(value.invoice_id)
    && finite(value.amount_applied) && value.amount_applied > 0
    && (value.fully_settled === undefined || typeof value.fully_settled === 'boolean');
  if (!Array.isArray(data.allocations) || !data.allocations.every(validAllocation)
    || !Array.isArray(data.allocation) || !data.allocation.every(validAllocation)) return false;
  const allocations = data.allocations as RecordB2bPaymentResult['allocations'];
  const legacy = data.allocation as RecordB2bPaymentResult['allocation'];
  const cents = (value: number) => {
    // L'aller-retour décimal évite les faux écarts binaires de value * 100.
    // NUMERIC(14,2) : douze chiffres entiers et deux décimales, sans arrondi métier.
    if (!Number.isFinite(value) || Math.abs(value) > 999_999_999_999.99
      || Number(value.toFixed(2)) !== value) return NaN;
    const rounded = Math.round(value * 100);
    return Number.isSafeInteger(rounded) ? rounded : NaN;
  };
  const byInvoice = new Map(allocations.map((item) => [item.invoice_id, item]));
  const legacyIds = new Set(legacy.map((item) => item.invoice_id));
  const total = allocations.reduce((sum, item) => sum + cents(item.amount_applied), 0);
  return byInvoice.size === allocations.length && legacyIds.size === legacy.length
    && legacy.length === allocations.length
    && legacy.every((item) => {
      const matching = byInvoice.get(item.invoice_id);
      return matching !== undefined && cents(matching.amount_applied) === cents(item.amount_applied)
        && (item.fully_settled === undefined || matching.fully_settled === undefined
          || item.fully_settled === matching.fully_settled);
    })
    && total === cents(data.allocated_total)
    && total + cents(data.unallocated) === cents(amount) && cents(amount) > 0;
}
