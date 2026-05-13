// apps/backoffice/src/features/purchasing/hooks/useReceivePurchaseOrder.ts
//
// Session 13 — Phase 3.A — calls receive_purchase_order_v1 atomic RPC.

import { useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/lib/supabase.js';
import { PURCHASE_ORDERS_QUERY_KEY } from './usePurchaseOrdersList.js';
import { PURCHASE_ORDER_DETAIL_QUERY_KEY } from './usePurchaseOrderDetail.js';

export type ReceivePOErrorCode =
  | 'forbidden'
  | 'po_id_required'
  | 'po_not_found'
  | 'po_invalid_status'
  | 'section_required'
  | 'section_not_found'
  | 'items_required'
  | 'po_item_id_required'
  | 'po_item_not_found'
  | 'quantity_must_be_positive'
  | 'received_exceeds_ordered'
  | 'product_not_found'
  | 'unknown';

export class ReceivePOError extends Error {
  constructor(public code: ReceivePOErrorCode, message?: string) {
    super(message ?? code);
    this.name = 'ReceivePOError';
  }
}

export interface ReceivePOLineArgs {
  poItemId:         string;
  receivedQuantity: number;
}

export interface ReceivePOArgs {
  poId:           string;
  sectionId:      string;
  items:          ReceivePOLineArgs[];
}

export interface ReceivePOResult {
  grn_id:            string;
  grn_number:        string;
  je_id:             string | null;
  movements_count:   number;
  subtotal:          number;
  vat_amount:        number;
  total:             number;
  status:            'partial' | 'received';
  idempotent_replay: boolean;
}

function classify(message: string): ReceivePOErrorCode {
  if (message.includes('forbidden'))                  return 'forbidden';
  if (message.includes('po_id_required'))             return 'po_id_required';
  if (message.includes('po_not_found'))               return 'po_not_found';
  if (message.includes('po_invalid_status'))          return 'po_invalid_status';
  if (message.includes('section_required'))           return 'section_required';
  if (message.includes('section_not_found'))          return 'section_not_found';
  if (message.includes('items_required'))             return 'items_required';
  if (message.includes('po_item_id_required'))        return 'po_item_id_required';
  if (message.includes('po_item_not_found'))          return 'po_item_not_found';
  if (message.includes('quantity_must_be_positive'))  return 'quantity_must_be_positive';
  if (message.includes('received_exceeds_ordered'))   return 'received_exceeds_ordered';
  if (message.includes('product_not_found'))          return 'product_not_found';
  return 'unknown';
}

export function useReceivePurchaseOrder() {
  const qc = useQueryClient();
  return useMutation<ReceivePOResult, ReceivePOError, ReceivePOArgs>({
    mutationFn: async (args) => {
      const idempotencyKey = crypto.randomUUID();
      const rpcArgs: Record<string, unknown> = {
        p_po_id:           args.poId,
        p_section_id:      args.sectionId,
        p_received_items:  args.items.map((it) => ({
          po_item_id:        it.poItemId,
          received_quantity: it.receivedQuantity,
        })),
        p_idempotency_key: idempotencyKey,
      };

      const { data, error } = await (supabase.rpc as unknown as (
        fn: string,
        args: Record<string, unknown>,
      ) => Promise<{ data: unknown; error: { message: string } | null }>)(
        'receive_purchase_order_v1',
        rpcArgs,
      );

      if (error !== null) throw new ReceivePOError(classify(error.message), error.message);
      if (data === null)  throw new ReceivePOError('unknown', 'Empty RPC response');
      return data as ReceivePOResult;
    },
    onSuccess: async (_data, vars) => {
      await Promise.all([
        qc.invalidateQueries({ queryKey: PURCHASE_ORDERS_QUERY_KEY }),
        qc.invalidateQueries({ queryKey: [...PURCHASE_ORDER_DETAIL_QUERY_KEY, vars.poId] }),
      ]);
    },
  });
}
