// apps/backoffice/src/features/purchasing/hooks/useRecordPoPayment.ts
//
// Paiement fournisseur d'un bon via la famille `record_po_payment` (v3,
// ADR-048). Gate serveur `purchasing.po.pay`. Idempotence saveur 2 : la
// fenêtre génère un UUID v4 et le réutilise à chaque nouvel essai.
//
// ADR-048 : le paiement porte la date réelle de décaissement choisie à la
// saisie (`p_paid_at`). Elle date la ligne, l'écriture et le contrôle de
// période. La fenêtre l'exige ; le serveur garde un défaut à l'instant courant.

import { useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/lib/supabase.js';
import { PO_PAYMENTS_QUERY_KEY } from './usePoPayments.js';
import { PURCHASE_ORDER_DETAIL_QUERY_KEY } from './usePurchaseOrderDetail.js';
import { PURCHASE_ORDERS_QUERY_KEY } from './usePurchaseOrdersList.js';
import { SUPPLIER_OUTSTANDING_QUERY_KEY } from '@/features/suppliers/hooks/useSupplierOutstanding.js';
import { SUPPLIER_PURCHASES_QUERY_KEY } from '@/features/suppliers/hooks/useSupplierPurchases.js';
import { invoiceErrorMessage } from '@/lib/invoiceFiles.js';

export type RecordPaymentErrorCode =
  | 'forbidden'
  | 'po_not_found'
  | 'amount_must_be_positive'
  | 'overpayment_not_allowed'
  | 'invalid_method'
  | 'po_cancelled'
  | 'invoice_required_before_payment'
  | 'period_locked'
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
  /** Date réelle du décaissement (`datetime-local`, lue au fuseau métier par le serveur). */
  paidAt:         string;
  idempotencyKey: string;   // UUID v4, stable across retries (caller owns it)
}

export interface RecordPaymentResult {
  payment_id:        string;
  je_id:             string | null;
  amount_paid:       number;
  paid_at:           string;
  total_paid:        number;
  remaining_due:     number;
  derived_status:    'unpaid' | 'partial' | 'paid';
  idempotent_replay: boolean;
}

export function classifyPaymentError(message: string): RecordPaymentErrorCode {
  if (message.includes('invoice_required_before_payment')) return 'invoice_required_before_payment';
  if (message.includes('forbidden') || message.includes('permission_denied')) return 'forbidden';
  if (message.includes('po_not_found'))            return 'po_not_found';
  if (message.includes('amount_must_be_positive')) return 'amount_must_be_positive';
  if (message.includes('overpayment'))             return 'overpayment_not_allowed';
  if (message.includes('invalid_method'))          return 'invalid_method';
  if (message.includes('po_cancelled'))            return 'po_cancelled';
  if (message.includes('period_locked') || message.includes('period_undefined')) return 'period_locked';
  return 'unknown';
}

/**
 * Friendly override for codes whose raw Postgres message should not reach the
 * UI as-is. `classify` only maps text → code; without this, a caller that
 * renders `error.message` directly would show the bare server string.
 */
export function paymentErrorMessage(code: RecordPaymentErrorCode, raw: string): string {
  if (code === 'invoice_required_before_payment') return invoiceErrorMessage(raw);
  if (code === 'po_cancelled') {
    return 'This purchase order is cancelled — no payment can be recorded.';
  }
  if (code === 'period_locked') {
    return 'The accounting period of this payment date is closed. Choose a date in an open period.';
  }
  return raw;
}

export function useRecordPoPayment() {
  const qc = useQueryClient();
  return useMutation<RecordPaymentResult, RecordPaymentError, RecordPaymentArgs>({
    mutationFn: async (args) => {
      const { data, error } = await supabase.rpc('record_po_payment_v3', {
        p_po_id:           args.poId,
        p_amount:          args.amount,
        p_method:          args.method,
        p_paid_at:         args.paidAt,
        p_idempotency_key: args.idempotencyKey,
        ...(args.reference !== undefined && args.reference.trim() !== ''
          ? { p_reference: args.reference.trim() }
          : {}),
      });
      if (error !== null) {
        const code = classifyPaymentError(error.message);
        throw new RecordPaymentError(code, paymentErrorMessage(code, error.message));
      }
      if (data === null)  throw new RecordPaymentError('unknown', 'Empty RPC response');
      return data as unknown as RecordPaymentResult;
    },
    onSuccess: async (_data, vars) => {
      await invalidatePoPaymentViews(qc, [vars.poId]);
    },
  });
}

/** Les vues qui lisent le grand livre des paiements fournisseurs. */
export async function invalidatePoPaymentViews(
  qc: ReturnType<typeof useQueryClient>, poIds: readonly string[],
): Promise<void> {
  await Promise.all([
    ...poIds.flatMap((poId) => [
      qc.invalidateQueries({ queryKey: [...PO_PAYMENTS_QUERY_KEY, poId] }),
      qc.invalidateQueries({ queryKey: [...PURCHASE_ORDER_DETAIL_QUERY_KEY, poId] }),
      qc.invalidateQueries({ queryKey: ['po-activity', poId] }),
    ]),
    qc.invalidateQueries({ queryKey: PURCHASE_ORDERS_QUERY_KEY }),
    // S3-07 — la fiche fournisseur lit le même grand livre (encours, badges).
    qc.invalidateQueries({ queryKey: SUPPLIER_OUTSTANDING_QUERY_KEY }),
    qc.invalidateQueries({ queryKey: SUPPLIER_PURCHASES_QUERY_KEY }),
  ]);
}
