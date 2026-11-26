// ADR-048 — le super admin contre-passe un paiement fournisseur enregistré par
// erreur (`reverse_po_payment_v1`). Le PIN est un ARGUMENT : la fonction le
// vérifie avec verrouillage. Un PIN faux revient en { ok:false,
// error:'invalid_pin' } ; les autres refus lèvent, code en tête du message.
// Un paiement groupé se contre-passe en entier : la réponse liste chaque bon.
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/lib/supabase.js';
import { invalidatePoPaymentViews } from './useRecordPoPayment.js';

export interface ReversePoPaymentInput {
  paymentId: string;
  /** Bons touchés (tous ceux du groupe), pour rafraîchir leurs vues. */
  poIds: readonly string[];
  reason: string;
  managerPin: string;
  /** Stable pour une ouverture de la fenêtre : un nouvel essai rejoue, il ne double pas. */
  idempotencyKey: string;
}

const KNOWN = [
  'invalid_pin', 'pin_required', 'account_locked', 'reason_required', 'super_admin_only',
  'payment_not_found', 'reversal_not_reversible', 'payment_already_reversed',
  'imported_payment_not_reversible', 'payment_entry_missing', 'payment_entry_mismatch',
  'bank_period_finalized', 'period_locked', 'period_undefined',
] as const;
export type ReversePoPaymentErrorCode = (typeof KNOWN)[number] | 'unknown';

export class ReversePoPaymentError extends Error {
  constructor(public readonly code: ReversePoPaymentErrorCode, message: string) {
    super(message);
    this.name = 'ReversePoPaymentError';
  }
}

/** Le code est le premier mot du message serveur (`period_locked: date …`). */
export function reverseCodeOf(message: string): ReversePoPaymentErrorCode {
  const head = message.split(':')[0]?.trim() ?? '';
  return (KNOWN as readonly string[]).includes(head) ? (head as ReversePoPaymentErrorCode) : 'unknown';
}

export function useReversePoPayment() {
  const qc = useQueryClient();
  return useMutation({
    retry: false,
    mutationFn: async (input: ReversePoPaymentInput): Promise<{ reversed: number }> => {
      const { data, error } = await supabase.rpc('reverse_po_payment_v1', {
        p_payment_id: input.paymentId,
        p_reason: input.reason.trim(),
        p_manager_pin: input.managerPin,
        p_idempotency_key: input.idempotencyKey,
      });
      if (error) throw new ReversePoPaymentError(reverseCodeOf(error.message), error.message);
      const body = (typeof data === 'object' && data !== null ? data : {}) as Record<string, unknown>;
      if (body.ok === false) {
        const code = typeof body.error === 'string' ? body.error : '';
        throw new ReversePoPaymentError(reverseCodeOf(code), code);
      }
      // Le serveur doit confirmer au moins une contre-passation ; sinon rien n'est affirmé.
      const lines = Array.isArray(body.lines) ? body.lines : [];
      if (body.ok !== true || lines.length === 0) {
        throw new ReversePoPaymentError('unknown', 'reversal_not_confirmed');
      }
      return { reversed: lines.length };
    },
    onSuccess: async (_, { poIds }) => {
      await invalidatePoPaymentViews(qc, poIds);
    },
  });
}

/** Phrase lisible pour chaque refus de `reverse_po_payment_v1`. */
export function reversePoPaymentMessage(err: unknown): string {
  const code = err instanceof ReversePoPaymentError ? err.code : 'unknown';
  switch (code) {
    case 'invalid_pin':
    case 'pin_required':
      return 'Wrong PIN. Try again.';
    case 'account_locked':
      return 'Too many wrong PINs. Your account is locked. Try again later.';
    case 'reason_required':
      return 'Write a reason (at least 3 characters).';
    case 'super_admin_only':
      return 'Only the super admin can reverse a supplier payment.';
    case 'payment_not_found':
      return 'This payment no longer exists. Reload the page.';
    case 'reversal_not_reversible':
      return 'A reversal cannot be reversed. Record a new payment instead.';
    case 'payment_already_reversed':
      return 'This payment is already reversed.';
    case 'imported_payment_not_reversible':
      return 'Payments on imported purchase orders cannot be reversed here.';
    case 'payment_entry_missing':
    case 'payment_entry_mismatch':
      return 'The journal entry of this payment is missing or changed. Ask accounting to check it.';
    case 'bank_period_finalized':
      return 'The bank reconciliation of this month is finalized. Reopen it first.';
    case 'period_locked':
    case 'period_undefined':
      return 'The accounting period of this payment date is closed. The payment cannot be reversed.';
    default:
      // La réponse a pu se perdre après l'écriture : on ne dit pas « rien n'a changé ».
      return 'The reversal could not be confirmed. Check the payment list before trying again.';
  }
}
