// apps/backoffice/src/features/purchasing/hooks/useUpdatePurchaseOrder.ts
//
// Session 46 — R4: edit a PO header + line items via update_purchase_order_v1.
// Gated server-side by purchasing.po.edit. The PO is LOCKED (D6) as soon as the
// first GRN OR the first payment exists, or once it leaves 'pending' — the RPC
// raises po_locked (P0001), surfaced here as a friendly message.

import { useMutation, useQueryClient } from '@tanstack/react-query';
import type { Json } from '@breakery/supabase';
import { supabase } from '@/lib/supabase.js';
import { PURCHASE_ORDERS_QUERY_KEY } from './usePurchaseOrdersList.js';
import { PURCHASE_ORDER_DETAIL_QUERY_KEY } from './usePurchaseOrderDetail.js';

export type UpdatePOErrorCode =
  | 'forbidden'
  | 'po_not_found'
  | 'po_locked'
  | 'items_required'
  | 'product_not_found'
  | 'product_not_raw_material'
  | 'quantity_must_be_positive'
  | 'unit_cost_must_be_non_negative'
  | 'invalid_payment_terms'
  | 'supplier_not_found'
  | 'unknown';

export class UpdatePOError extends Error {
  constructor(public code: UpdatePOErrorCode, message?: string) {
    super(message ?? code);
    this.name = 'UpdatePOError';
  }
}

export interface UpdatePOItemArg {
  product_id:          string;
  quantity:            number;
  unit?:               string;
  unit_factor_to_base?: number;
  unit_cost:           number;
  notes?:              string;
}

export interface UpdatePOArgs {
  poId:           string;
  supplierId?:    string;
  expectedDate?:  string | null;
  paymentTerms?:  'cash' | 'credit';
  notes?:         string;
  items?:         UpdatePOItemArg[];   // replaces ALL lines when present
}

export interface UpdatePOResult {
  po_id:        string;
  po_number:    string;
  subtotal:     number;
  vat_amount:   number;
  total_amount: number;
  item_count:   number;
  status:       'pending';
}

/** Human-friendly message for the lock / gate codes (FR/EN mixed per house style). */
export function updatePoErrorMessage(code: UpdatePOErrorCode): string {
  switch (code) {
    case 'po_locked':
      return 'This PO can no longer be edited — it has been received or paid.';
    case 'forbidden':
      return 'You do not have permission to edit purchase orders.';
    case 'product_not_raw_material':
      return 'Only raw-material products can be ordered.';
    case 'supplier_not_found':
      return 'Selected supplier is not available.';
    default:
      return 'Could not save changes. Please review the order and try again.';
  }
}

function classify(message: string): UpdatePOErrorCode {
  if (message.includes('po_locked'))                       return 'po_locked';
  if (message.includes('permission_denied') || message.includes('forbidden')) return 'forbidden';
  if (message.includes('po_not_found'))                    return 'po_not_found';
  if (message.includes('items_required'))                  return 'items_required';
  if (message.includes('product_not_raw_material'))        return 'product_not_raw_material';
  if (message.includes('product_not_found'))               return 'product_not_found';
  if (message.includes('quantity_must_be_positive'))       return 'quantity_must_be_positive';
  if (message.includes('unit_cost_must_be_non_negative'))  return 'unit_cost_must_be_non_negative';
  if (message.includes('invalid_payment_terms'))           return 'invalid_payment_terms';
  if (message.includes('supplier_not_found'))              return 'supplier_not_found';
  return 'unknown';
}

export function useUpdatePurchaseOrder() {
  const qc = useQueryClient();
  return useMutation<UpdatePOResult, UpdatePOError, UpdatePOArgs>({
    mutationFn: async (args) => {
      const patch: Record<string, unknown> = {};
      if (args.supplierId !== undefined)   patch['supplier_id']   = args.supplierId;
      if (args.expectedDate !== undefined) patch['expected_date'] = args.expectedDate;
      if (args.paymentTerms !== undefined) patch['payment_terms'] = args.paymentTerms;
      if (args.notes !== undefined)        patch['notes']         = args.notes;
      if (args.items !== undefined)        patch['items']         = args.items;

      const { data, error } = await supabase.rpc('update_purchase_order_v1', {
        p_po_id: args.poId,
        p_patch: patch as unknown as Json,
      });

      if (error !== null) throw new UpdatePOError(classify(error.message), error.message);
      if (data === null)  throw new UpdatePOError('unknown', 'Empty RPC response');
      return data as unknown as UpdatePOResult;
    },
    onSuccess: async (_data, vars) => {
      await Promise.all([
        qc.invalidateQueries({ queryKey: PURCHASE_ORDERS_QUERY_KEY }),
        qc.invalidateQueries({ queryKey: [...PURCHASE_ORDER_DETAIL_QUERY_KEY, vars.poId] }),
      ]);
    },
  });
}
