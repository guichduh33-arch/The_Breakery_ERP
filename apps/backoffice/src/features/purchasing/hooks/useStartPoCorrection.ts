// ADR-050 — correction guidée d'un bon reçu et/ou payé (`start_po_correction_v1`).
// Super admin seul ; le PIN est un ARGUMENT, vérifié avec verrouillage par la
// fonction. Un PIN faux revient en { ok:false, error:'invalid_pin' } ; les autres
// refus lèvent, code en tête du message — y compris ceux de la contre-passation
// et de l'annulation de réception que la fonction enchaîne. Comme la
// contre-passation (ADR-048), un rejeu de la même clé renvoie le premier
// résultat sans revérifier le PIN : il ne fait aucune écriture.
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/lib/supabase.js';
import { invalidateStockQueries } from '@/features/inventory/invalidateStockQueries.js';
import { SUPPLIER_DETAIL_QUERY_KEY } from '@/features/suppliers/hooks/useSupplierDetail.js';
import { SUPPLIER_PURCHASE_ITEMS_QUERY_KEY } from '@/features/suppliers/hooks/useSupplierPurchaseItems.js';
import { PRODUCT_PURCHASE_ITEMS_QUERY_KEY } from '@/features/products/hooks/useProductPurchaseItems.js';
import { invalidatePoPaymentViews } from './useRecordPoPayment.js';

export interface StartPoCorrectionInput {
  poId:           string;
  reason:         string;
  managerPin:     string;
  /** Stable pour une ouverture de la fenêtre : un nouvel essai rejoue. */
  idempotencyKey: string;
}

export interface StartPoCorrectionResult {
  status:            string;
  reversedPayments:  number;
  cancelledReceipts: number;
  /** Autres bons touchés par un paiement groupé contre-passé en entier. */
  otherPoIds:        string[];
}

const KNOWN = [
  'invalid_pin', 'pin_required', 'account_locked', 'reason_required', 'super_admin_only',
  'po_not_found', 'po_correction_nothing_to_correct', 'po_correction_historical_import',
  'po_correction_invalid_status', 'insufficient_stock_to_reverse',
  'bank_period_finalized', 'period_locked', 'period_undefined',
  'payment_entry_missing', 'payment_entry_mismatch',
  'imported_payment_not_reversible', 'payment_already_reversed', 'grn_already_cancelled',
  'payments_exceed_remaining_receipts', 'historical_import_grn_not_cancellable',
] as const;
export type StartPoCorrectionErrorCode = (typeof KNOWN)[number] | 'unknown';

export class StartPoCorrectionError extends Error {
  constructor(public readonly code: StartPoCorrectionErrorCode, message: string) {
    super(message);
    this.name = 'StartPoCorrectionError';
  }
}

/** Le code est le premier mot du message serveur (`period_locked: date …`). */
export function correctionCodeOf(message: string): StartPoCorrectionErrorCode {
  const head = message.split(':')[0]?.trim() ?? '';
  return (KNOWN as readonly string[]).includes(head) ? (head as StartPoCorrectionErrorCode) : 'unknown';
}

function ids(v: unknown): string[] {
  return Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : [];
}

export function useStartPoCorrection() {
  const qc = useQueryClient();
  return useMutation({
    retry: false,
    mutationFn: async (input: StartPoCorrectionInput): Promise<StartPoCorrectionResult> => {
      const { data, error } = await supabase.rpc('start_po_correction_v1', {
        p_po_id:           input.poId,
        p_reason:          input.reason.trim(),
        p_manager_pin:     input.managerPin,
        p_idempotency_key: input.idempotencyKey,
      });
      if (error) throw new StartPoCorrectionError(correctionCodeOf(error.message), error.message);
      const body = (typeof data === 'object' && data !== null ? data : {}) as Record<string, unknown>;
      if (body.ok === false) {
        const code = typeof body.error === 'string' ? body.error : '';
        throw new StartPoCorrectionError(correctionCodeOf(code), code);
      }
      if (body.ok !== true) throw new StartPoCorrectionError('unknown', 'correction_not_confirmed');
      return {
        status:            typeof body.status === 'string' ? body.status : 'pending',
        reversedPayments:  ids(body.reversed_payment_ids).length,
        cancelledReceipts: ids(body.cancelled_grn_ids).length,
        otherPoIds:        ids(body.other_po_ids),
      };
    },
    onSuccess: async (result, { poId }) => {
      await Promise.all([
        invalidatePoPaymentViews(qc, [poId, ...result.otherPoIds]),
        qc.invalidateQueries({ queryKey: SUPPLIER_DETAIL_QUERY_KEY }),
        qc.invalidateQueries({ queryKey: SUPPLIER_PURCHASE_ITEMS_QUERY_KEY }),
        qc.invalidateQueries({ queryKey: PRODUCT_PURCHASE_ITEMS_QUERY_KEY }),
        // Rapports d'achat, valorisation, prix d'achat et écritures inverses.
        qc.invalidateQueries({ queryKey: ['reports'] }),
        qc.invalidateQueries({ queryKey: ['stock-position'] }),
        qc.invalidateQueries({ queryKey: ['purchase-price-points'] }),
        qc.invalidateQueries({ queryKey: ['purchase-price-trends'] }),
        qc.invalidateQueries({ queryKey: ['accounting'] }),
        invalidateStockQueries(qc),
      ]);
    },
  });
}

/** Phrase lisible pour chaque refus de la correction. */
export function startPoCorrectionMessage(err: unknown): string {
  const code = err instanceof StartPoCorrectionError ? err.code : 'unknown';
  switch (code) {
    case 'invalid_pin':
    case 'pin_required':
      return 'Wrong PIN. Try again.';
    case 'account_locked':
      return 'Too many wrong PINs. Your account is locked. Try again later.';
    case 'reason_required':
      return 'Write a reason (at least 3 characters).';
    case 'super_admin_only':
      return 'Only the super admin can correct a received or paid purchase order.';
    case 'po_not_found':
      return 'This purchase order no longer exists. Reload the page.';
    case 'po_correction_nothing_to_correct':
      return 'Nothing to correct: no receipt and no payment is recorded. Use Edit instead.';
    case 'po_correction_historical_import':
      return 'Imported purchase orders cannot be corrected here.';
    case 'po_correction_invalid_status':
      return 'A cancelled purchase order cannot be corrected.';
    case 'insufficient_stock_to_reverse':
      return 'Part of the received stock is already used. The receipt cannot be taken back out of stock. Nothing was changed.';
    case 'bank_period_finalized':
      return 'The bank reconciliation of a payment month is finalized. Reopen it first. Nothing was changed.';
    case 'period_locked':
    case 'period_undefined':
      return 'An accounting period this correction touches is closed. Nothing was changed.';
    case 'payment_entry_missing':
    case 'payment_entry_mismatch':
      return 'The journal entry of a payment is missing or changed. Ask accounting to check it. Nothing was changed.';
    case 'imported_payment_not_reversible':
    case 'historical_import_grn_not_cancellable':
      return 'A payment or receipt on this order came from an import and cannot be reversed here. Nothing was changed.';
    case 'payment_already_reversed':
    case 'grn_already_cancelled':
      return 'Someone changed this order at the same time. Reload the page and check it. Nothing was changed.';
    case 'payments_exceed_remaining_receipts':
      return 'The payments could not be cleared before the receipts. Ask accounting to check this order. Nothing was changed.';
    default:
      // La réponse a pu se perdre après l'écriture : on ne dit pas « rien n'a changé ».
      return 'The correction could not be confirmed. Reload the page and check the order before trying again.';
  }
}
