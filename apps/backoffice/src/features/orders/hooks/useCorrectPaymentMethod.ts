// ADR-046 — le super admin corrige le moyen d'un règlement de vente
// (correct_order_payment_method_v1). Le PIN est un ARGUMENT de la fonction :
// c'est elle qui le vérifie, avec verrouillage (même contrat qu'undo_shift_close).
// Un PIN faux revient en réponse { ok:false, error:'invalid_pin' } ; les autres
// refus lèvent avec le code nu comme message. Le serveur décide de tout le reste.
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/lib/supabase.js';
import type { PaymentMethod } from '@/features/orders/statusMeta.js';

export interface CorrectPaymentMethodInput {
  paymentId: string;
  orderId: string;
  newMethod: PaymentMethod;
  reason: string;
  managerPin: string;
  /** Stable pour une ouverture de la fenêtre : un nouvel essai rejoue, il ne double pas. */
  idempotencyKey: string;
}

export interface CorrectPaymentMethodResult {
  correctionId: string;
  journalEntryId: string | null;
  sessionClosed: boolean;
}

/** Codes connus de la fonction ; tout autre message se lit comme « unknown ». */
const KNOWN = [
  'invalid_pin', 'pin_required', 'account_locked', 'reason_required', 'super_admin_only',
  'payment_not_found', 'imported_sale_not_correctable', 'order_voided', 'order_not_paid',
  'b2b_not_correctable', 'outstanding_sale_not_correctable', 'order_refunded', 'same_method',
  'store_credit_not_correctable', 'idempotency_key_reused', 'sale_entry_missing',
  'sale_entry_mismatch', 'payment_already_reconciled', 'bank_period_finalized',
  'period_locked', 'period_undefined',
] as const;
export type CorrectPaymentMethodErrorCode = (typeof KNOWN)[number] | 'unknown';

export class CorrectPaymentMethodError extends Error {
  constructor(public readonly code: CorrectPaymentMethodErrorCode, message: string) {
    super(message);
    this.name = 'CorrectPaymentMethodError';
  }
}

function codeOf(message: string): CorrectPaymentMethodErrorCode {
  return (KNOWN as readonly string[]).includes(message) ? (message as CorrectPaymentMethodErrorCode) : 'unknown';
}

export function useCorrectPaymentMethod() {
  const qc = useQueryClient();
  return useMutation({
    retry: false,
    mutationFn: async (input: CorrectPaymentMethodInput): Promise<CorrectPaymentMethodResult> => {
      const { data, error } = await supabase.rpc('correct_order_payment_method_v1', {
        p_payment_id: input.paymentId,
        p_new_method: input.newMethod,
        p_reason: input.reason.trim(),
        p_manager_pin: input.managerPin,
        p_idempotency_key: input.idempotencyKey,
      });
      if (error) throw new CorrectPaymentMethodError(codeOf(error.message), error.message);
      const body = (typeof data === 'object' && data !== null ? data : {}) as Record<string, unknown>;
      if (body.ok === false) {
        const code = typeof body.error === 'string' ? body.error : '';
        throw new CorrectPaymentMethodError(codeOf(code), code);
      }
      // Le serveur doit confirmer CE règlement et CE moyen ; sinon rien n'est affirmé.
      if (body.ok !== true || body.payment_id !== input.paymentId || body.new_method !== input.newMethod
        || typeof body.correction_id !== 'string') {
        throw new CorrectPaymentMethodError('unknown', 'correction_not_confirmed');
      }
      return {
        correctionId: body.correction_id,
        journalEntryId: typeof body.journal_entry_id === 'string' ? body.journal_entry_id : null,
        sessionClosed: body.session_closed === true,
      };
    },
    onSuccess: (_, { orderId }) => {
      void qc.invalidateQueries({ queryKey: ['order-detail', orderId] });
      void qc.invalidateQueries({ queryKey: ['orders', 'list'] });
    },
  });
}

/** Phrase lisible pour chaque refus de correct_order_payment_method_v1. */
export function correctPaymentMethodMessage(err: unknown): string {
  const code = err instanceof CorrectPaymentMethodError ? err.code : 'unknown';
  switch (code) {
    case 'invalid_pin':
    case 'pin_required':
      return 'Wrong PIN. Try again.';
    case 'account_locked':
      return 'Account locked after too many wrong PINs. Try again later.';
    case 'reason_required':
      return 'Enter a reason of at least 3 characters.';
    case 'super_admin_only':
      return 'Only the super admin can correct a payment method.';
    case 'payment_not_found':
      return 'This payment no longer exists.';
    case 'imported_sale_not_correctable':
      return 'This sale was imported from the previous POS. It cannot be corrected here.';
    case 'order_voided':
      return 'This order is voided. Its payment cannot be corrected.';
    case 'order_not_paid':
      return 'This order is not paid yet.';
    case 'b2b_not_correctable':
      return 'B2B payments are recorded in the customer ledger, not here.';
    case 'outstanding_sale_not_correctable':
      return 'This sale was settled later as an outstanding ticket. It cannot be corrected here.';
    case 'order_refunded':
      return 'This order has a refund. Its payment cannot be corrected.';
    case 'same_method':
      return 'The payment already uses this method.';
    case 'store_credit_not_correctable':
      return 'Store credit cannot be corrected: it changes a customer balance.';
    case 'payment_already_reconciled':
      return 'This payment is already matched in a bank reconciliation. Remove that match first.';
    case 'bank_period_finalized':
      return 'The bank reconciliation for this date is finalized. The payment cannot be corrected.';
    case 'period_locked':
    case 'period_undefined':
      return 'The accounting period of this sale is closed. The payment cannot be corrected.';
    case 'sale_entry_missing':
    case 'sale_entry_mismatch':
      return 'The sale journal entry does not match this payment. Check the journal before correcting.';
    case 'idempotency_key_reused':
      return 'This request was already used for another change. Close the window and start again.';
    default:
      return 'The correction is not confirmed. Check the connection and try again.';
  }
}
