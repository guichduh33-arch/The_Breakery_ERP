// ADR-048 — règlement groupé : un seul paiement couvre plusieurs bons d'un
// même fournisseur (`record_supplier_payment_v2`). Le serveur répartit le
// montant du plus ancien bon au plus récent, écrit une ligne et une écriture
// par bon, toutes liées par le même groupe. Gate serveur `purchasing.po.pay`.
// La clé d'idempotence est celle du groupe : un nouvel essai rejoue.

import { useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/lib/supabase.js';
import {
  RecordPaymentError,
  classifyPaymentError,
  invalidatePoPaymentViews,
  paymentErrorMessage,
  type PoPaymentMethod,
} from '@/features/purchasing/hooks/useRecordPoPayment.js';

export interface RecordSupplierPaymentArgs {
  supplierId:     string;
  poIds:          string[];
  amount:         number;
  method:         PoPaymentMethod;
  reference?:     string;
  /** Date réelle du décaissement (`datetime-local`). */
  paidAt:         string;
  idempotencyKey: string;
}

export interface SupplierPaymentLine {
  po_id:      string;
  payment_id: string;
  amount:     number;
}

export interface RecordSupplierPaymentResult {
  payment_group_id:  string;
  amount_paid:       number;
  lines:             SupplierPaymentLine[];
  idempotent_replay: boolean;
}

export function supplierPaymentErrorMessage(raw: string): string {
  if (raw.includes('po_nothing_due')) return 'One of the selected purchase orders is already fully paid. Reload the list.';
  if (raw.includes('po_supplier_mismatch')) return 'All selected purchase orders must belong to this supplier.';
  if (raw.includes('po_ids_required')) return 'Select at least one purchase order.';
  return paymentErrorMessage(classifyPaymentError(raw), raw);
}

export function useRecordSupplierPayment() {
  const qc = useQueryClient();
  return useMutation<RecordSupplierPaymentResult, RecordPaymentError, RecordSupplierPaymentArgs>({
    retry: false,
    mutationFn: async (args) => {
      const { data, error } = await supabase.rpc('record_supplier_payment_v2', {
        p_supplier_id:     args.supplierId,
        p_po_ids:          args.poIds,
        p_amount:          args.amount,
        p_method:          args.method,
        p_paid_at:         args.paidAt,
        p_idempotency_key: args.idempotencyKey,
        ...(args.reference !== undefined && args.reference.trim() !== ''
          ? { p_reference: args.reference.trim() }
          : {}),
      });
      if (error !== null) {
        throw new RecordPaymentError(classifyPaymentError(error.message), supplierPaymentErrorMessage(error.message));
      }
      const body = data as unknown as RecordSupplierPaymentResult | null;
      if (body === null || !Array.isArray(body.lines) || body.lines.length === 0) {
        throw new RecordPaymentError('unknown', 'The payment was not confirmed. Reload before trying again.');
      }
      // Rejeu d'une saisie dont la réponse s'était perdue, mais avec un montant
      // modifié depuis : le serveur a rendu la PREMIÈRE saisie, pas celle-ci.
      if (body.idempotent_replay && Math.abs(Number(body.amount_paid) - args.amount) > 0.005) {
        throw new RecordPaymentError('unknown',
          'A payment was already recorded from this window with another amount. Close it and check the payment list.');
      }
      return body;
    },
    onSuccess: async (_data, vars) => {
      await invalidatePoPaymentViews(qc, vars.poIds);
    },
  });
}
