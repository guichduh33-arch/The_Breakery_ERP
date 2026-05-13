// apps/backoffice/src/features/purchasing/hooks/useCancelPurchaseOrder.ts
//
// Session 13 — Phase 3.A — calls cancel_purchase_order_v1 RPC.

import { useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/lib/supabase.js';
import { PURCHASE_ORDERS_QUERY_KEY } from './usePurchaseOrdersList.js';
import { PURCHASE_ORDER_DETAIL_QUERY_KEY } from './usePurchaseOrderDetail.js';

export type CancelPOErrorCode =
  | 'forbidden'
  | 'po_id_required'
  | 'reason_required'
  | 'po_not_found'
  | 'PO_ALREADY_RECEIVED'
  | 'PO_ALREADY_CANCELLED'
  | 'PO_PARTIALLY_RECEIVED'
  | 'unknown';

export class CancelPOError extends Error {
  constructor(public code: CancelPOErrorCode, message?: string) {
    super(message ?? code);
    this.name = 'CancelPOError';
  }
}

export interface CancelPOArgs {
  poId:    string;
  reason:  string;
}

export interface CancelPOResult {
  po_id:     string;
  po_number: string;
  status:    'cancelled';
  reason:    string;
}

function classify(message: string): CancelPOErrorCode {
  if (message.includes('forbidden'))                return 'forbidden';
  if (message.includes('po_id_required'))           return 'po_id_required';
  if (message.includes('reason_required'))          return 'reason_required';
  if (message.includes('po_not_found'))             return 'po_not_found';
  if (message.includes('PO_ALREADY_RECEIVED'))      return 'PO_ALREADY_RECEIVED';
  if (message.includes('PO_ALREADY_CANCELLED'))     return 'PO_ALREADY_CANCELLED';
  if (message.includes('PO_PARTIALLY_RECEIVED'))    return 'PO_PARTIALLY_RECEIVED';
  return 'unknown';
}

export function useCancelPurchaseOrder() {
  const qc = useQueryClient();
  return useMutation<CancelPOResult, CancelPOError, CancelPOArgs>({
    mutationFn: async (args) => {
      const { data, error } = await (supabase.rpc as unknown as (
        fn: string,
        args: Record<string, unknown>,
      ) => Promise<{ data: unknown; error: { message: string } | null }>)(
        'cancel_purchase_order_v1',
        { p_po_id: args.poId, p_reason: args.reason },
      );
      if (error !== null) throw new CancelPOError(classify(error.message), error.message);
      if (data === null)  throw new CancelPOError('unknown', 'Empty RPC response');
      return data as CancelPOResult;
    },
    onSuccess: async (_data, vars) => {
      await Promise.all([
        qc.invalidateQueries({ queryKey: PURCHASE_ORDERS_QUERY_KEY }),
        qc.invalidateQueries({ queryKey: [...PURCHASE_ORDER_DETAIL_QUERY_KEY, vars.poId] }),
      ]);
    },
  });
}
