// apps/backoffice/src/features/purchasing/hooks/useCancelGoodsReceipt.ts
//
// S3-05 — annule une réception (GRN) via `cancel_goods_receipt_v1`.
//
// La fonction serveur contre-passe le stock, le coût moyen, l'écriture du GRN
// et les quantités reçues, puis recalcule le statut du bon. Ce crochet :
//   * porte la clé d'idempotence (UUID en `useRef`), stable entre deux essais
//     sur la MÊME réception et renouvelée après un succès — une clé consommée
//     par une réception serait refusée (`idempotency_key_conflict`) sur une autre ;
//   * valide la réponse (le client typé renvoie `Json`, un cast ne vérifie rien) ;
//   * traduit les refus serveur en phrases anglaises pour l'écran ;
//   * invalide le bon, les listes, le stock, les vues fournisseur et les rapports
//     d'achat et de comptabilité touchés par la contre-passation.

import { useRef } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/lib/supabase.js';
import { invalidateStockQueries } from '@/features/inventory/invalidateStockQueries.js';
import { PURCHASE_ORDERS_QUERY_KEY } from './usePurchaseOrdersList.js';
import { PURCHASE_ORDER_DETAIL_QUERY_KEY } from './usePurchaseOrderDetail.js';
import { SUPPLIER_DETAIL_QUERY_KEY } from '@/features/suppliers/hooks/useSupplierDetail.js';
import { SUPPLIER_OUTSTANDING_QUERY_KEY } from '@/features/suppliers/hooks/useSupplierOutstanding.js';
import { SUPPLIER_PURCHASES_QUERY_KEY } from '@/features/suppliers/hooks/useSupplierPurchases.js';
import { SUPPLIER_PURCHASE_ITEMS_QUERY_KEY } from '@/features/suppliers/hooks/useSupplierPurchaseItems.js';
import { PRODUCT_PURCHASE_ITEMS_QUERY_KEY } from '@/features/products/hooks/useProductPurchaseItems.js';

export type CancelReceiptErrorCode =
  | 'not_authenticated'
  | 'forbidden'
  | 'reason_required'
  | 'grn_not_found'
  | 'po_not_found'
  | 'grn_already_cancelled'
  | 'historical_import_grn_not_cancellable'
  | 'po_invalid_status'
  | 'payments_exceed_remaining_receipts'
  | 'insufficient_stock_to_reverse'
  | 'received_quantity_inconsistent'
  | 'idempotency_key_conflict'
  | 'period_closed'
  | 'invalid_response'
  | 'unknown';

/** Valeurs extraites du message serveur, quand il en porte. */
export interface CancelReceiptErrorDetails {
  productId?:          string;
  stock?:              number;
  toRemove?:           number;
  paid?:               number;
  remainingReceived?:  number;
  poStatus?:           string;
}

export class CancelReceiptError extends Error {
  constructor(
    public code: CancelReceiptErrorCode,
    public serverMessage: string,
    public details: CancelReceiptErrorDetails = {},
  ) {
    super(serverMessage);
    this.name = 'CancelReceiptError';
  }
}

export interface CancelReceiptArgs {
  grnId:  string;
  poId:   string;
  reason: string;
}

export interface CancelReceiptResult {
  grn_id:            string;
  grn_number:        string;
  po_id:             string;
  previous_status:   string;
  status:            'pending' | 'partial' | 'received';
  movements_count:   number;
  reversal_je_id:    string | null;
  reversed_je_id:    string | null;
  cancelled_total:   number;
  idempotent_replay: boolean;
}

// L'ordre compte : `payments_exceed_remaining_receipts` contient `remaining_received`,
// et les codes génériques (`forbidden`) passent après les codes précis.
export function classifyCancelReceiptError(message: string): CancelReceiptErrorCode {
  if (message.includes('payments_exceed_remaining_receipts'))    return 'payments_exceed_remaining_receipts';
  if (message.includes('insufficient_stock_to_reverse'))         return 'insufficient_stock_to_reverse';
  if (message.includes('received_quantity_inconsistent'))        return 'received_quantity_inconsistent';
  if (message.includes('historical_import_grn_not_cancellable')) return 'historical_import_grn_not_cancellable';
  if (message.includes('grn_already_cancelled'))                 return 'grn_already_cancelled';
  if (message.includes('idempotency_key_conflict'))              return 'idempotency_key_conflict';
  if (message.includes('po_invalid_status'))                     return 'po_invalid_status';
  if (message.includes('grn_not_found'))                         return 'grn_not_found';
  if (message.includes('po_not_found'))                          return 'po_not_found';
  if (message.includes('reason_required'))                       return 'reason_required';
  if (message.includes('period_locked') || message.includes('period_undefined')) return 'period_closed';
  if (message.includes('not_authenticated'))                     return 'not_authenticated';
  if (message.includes('forbidden'))                             return 'forbidden';
  return 'unknown';
}

function num(message: string, key: string): number | undefined {
  const m = new RegExp(`${key}=(-?[0-9.]+)`).exec(message);
  return m === null ? undefined : Number(m[1]);
}

export function parseCancelReceiptDetails(message: string): CancelReceiptErrorDetails {
  const details: CancelReceiptErrorDetails = {};
  const product = /product=([0-9a-f-]{36})/i.exec(message);
  if (product !== null) details.productId = product[1]!;
  const stock = num(message, 'stock');
  if (stock !== undefined) details.stock = stock;
  const toRemove = num(message, 'to_remove');
  if (toRemove !== undefined) details.toRemove = toRemove;
  const paid = num(message, 'paid');
  if (paid !== undefined) details.paid = paid;
  const remaining = num(message, 'remaining_received');
  if (remaining !== undefined) details.remainingReceived = remaining;
  const status = /po_invalid_status:\s*([a-z_]+)/.exec(message);
  if (status !== null) details.poStatus = status[1]!;
  return details;
}

function fmtAmount(n: number | undefined): string {
  return n === undefined ? '' : ` (IDR ${n.toLocaleString('en-US')})`;
}

/**
 * Phrase affichée pour un refus. `productName` vient de l'écran, qui connaît
 * les lignes du bon ; le serveur ne renvoie que l'identifiant du produit.
 */
export function cancelReceiptErrorMessage(err: CancelReceiptError, productName?: string): string {
  const d = err.details;
  switch (err.code) {
    case 'payments_exceed_remaining_receipts':
      return 'Payments already recorded on this order' + fmtAmount(d.paid)
        + ' exceed what would remain received' + fmtAmount(d.remainingReceived)
        + '. Settle the payment with the supplier (refund or credit) before cancelling this receipt. '
        + 'A cash-on-delivery receipt is always paid on reception, so it cannot be cancelled here.';
    case 'insufficient_stock_to_reverse':
      return `Part of this receipt has already been used: ${productName ?? 'a product'} has `
        + `${d.stock ?? '?'} in stock but ${d.toRemove ?? '?'} would have to be removed. `
        + 'Cancel the receipt only for goods still on hand, or record the difference as waste.';
    case 'received_quantity_inconsistent':
      return 'The received quantity on this order no longer matches the receipt. Nothing was changed — contact an administrator.';
    case 'grn_already_cancelled':
      return 'This receipt has already been cancelled.';
    case 'historical_import_grn_not_cancellable':
      return 'This receipt comes from the historical import and cannot be cancelled.';
    case 'po_invalid_status':
      return `A receipt can only be cancelled on a partially or fully received order (current status: ${d.poStatus ?? 'unknown'}).`;
    case 'grn_not_found':
      return 'This receipt no longer exists. Refresh the page.';
    case 'po_not_found':
      return 'This purchase order no longer exists. Refresh the page.';
    case 'reason_required':
      return 'A reason of at least 3 characters is required.';
    case 'period_closed':
      return 'The accounting period for today is closed or not defined, so the reversal entry cannot be posted.';
    case 'idempotency_key_conflict':
      return 'This request conflicted with another cancellation. Close the dialog and try again.';
    case 'not_authenticated':
      return 'Your session has expired. Sign in again.';
    case 'forbidden':
      return 'You do not have permission to cancel receipts.';
    case 'invalid_response':
      return 'The server returned an unexpected response. Refresh the page to check the receipt.';
    default:
      return err.serverMessage !== '' ? err.serverMessage : 'Unknown error';
  }
}

function isStatus(v: unknown): v is CancelReceiptResult['status'] {
  return v === 'pending' || v === 'partial' || v === 'received';
}

/** Valide la réponse de la RPC : un objet sans ces champs n'est pas une annulation. */
export function parseCancelReceiptResult(data: unknown): CancelReceiptResult {
  if (data === null || typeof data !== 'object' || Array.isArray(data)) {
    throw new CancelReceiptError('invalid_response', 'Empty or malformed RPC response');
  }
  const r = data as Record<string, unknown>;
  if (typeof r.grn_id !== 'string' || typeof r.po_id !== 'string' || !isStatus(r.status)) {
    throw new CancelReceiptError('invalid_response', 'Malformed RPC response');
  }
  const optId = (v: unknown): string | null => (typeof v === 'string' ? v : null);
  return {
    grn_id:            r.grn_id,
    grn_number:        typeof r.grn_number === 'string' ? r.grn_number : '',
    po_id:             r.po_id,
    previous_status:   typeof r.previous_status === 'string' ? r.previous_status : '',
    status:            r.status,
    movements_count:   Number(r.movements_count ?? 0),
    reversal_je_id:    optId(r.reversal_je_id),
    reversed_je_id:    optId(r.reversed_je_id),
    cancelled_total:   Number(r.cancelled_total ?? 0),
    idempotent_replay: r.idempotent_replay === true,
  };
}

export function useCancelGoodsReceipt() {
  const qc = useQueryClient();
  // Une clé par réception : un nouvel essai sur la même réception la réutilise,
  // le serveur rejoue alors la première réponse au lieu d'annuler deux fois.
  const keyRef = useRef<{ grnId: string; key: string } | null>(null);

  const mutation = useMutation<CancelReceiptResult, CancelReceiptError, CancelReceiptArgs>({
    mutationFn: async (args) => {
      if (keyRef.current?.grnId !== args.grnId) {
        keyRef.current = { grnId: args.grnId, key: crypto.randomUUID() };
      }
      const key = keyRef.current.key;
      const { data, error } = await (supabase.rpc as unknown as (
        fn: string,
        args: Record<string, unknown>,
      ) => Promise<{ data: unknown; error: { message: string } | null }>)(
        'cancel_goods_receipt_v1',
        { p_grn_id: args.grnId, p_reason: args.reason, p_idempotency_key: key },
      );
      if (error !== null) {
        throw new CancelReceiptError(
          classifyCancelReceiptError(error.message),
          error.message,
          parseCancelReceiptDetails(error.message),
        );
      }
      return parseCancelReceiptResult(data);
    },
    onSuccess: async (_data, vars) => {
      keyRef.current = null;
      await Promise.all([
        qc.invalidateQueries({ queryKey: PURCHASE_ORDERS_QUERY_KEY }),
        qc.invalidateQueries({ queryKey: [...PURCHASE_ORDER_DETAIL_QUERY_KEY, vars.poId] }),
        qc.invalidateQueries({ queryKey: SUPPLIER_DETAIL_QUERY_KEY }),
        qc.invalidateQueries({ queryKey: SUPPLIER_OUTSTANDING_QUERY_KEY }),
        qc.invalidateQueries({ queryKey: SUPPLIER_PURCHASES_QUERY_KEY }),
        qc.invalidateQueries({ queryKey: SUPPLIER_PURCHASE_ITEMS_QUERY_KEY }),
        qc.invalidateQueries({ queryKey: PRODUCT_PURCHASE_ITEMS_QUERY_KEY }),
        // Rapports d'achat (`['reports', 'purchase-…']`), valorisation et prix d'achat.
        qc.invalidateQueries({ queryKey: ['reports'] }),
        qc.invalidateQueries({ queryKey: ['stock-position'] }),
        qc.invalidateQueries({ queryKey: ['purchase-price-points'] }),
        qc.invalidateQueries({ queryKey: ['purchase-price-trends'] }),
        // Écriture de contre-passation : journal, grand livre, états.
        qc.invalidateQueries({ queryKey: ['accounting'] }),
        invalidateStockQueries(qc),
      ]);
    },
  });
  return mutation;
}
