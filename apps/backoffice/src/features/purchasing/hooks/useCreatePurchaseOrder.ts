// apps/backoffice/src/features/purchasing/hooks/useCreatePurchaseOrder.ts
//
// Session 13 — Phase 3.A — calls create_purchase_order_v1 atomic RPC.

import { useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/lib/supabase.js';
import { PURCHASE_ORDERS_QUERY_KEY } from './usePurchaseOrdersList.js';

export type CreatePOErrorCode =
  | 'forbidden'
  | 'supplier_required'
  | 'supplier_not_found'
  | 'items_required'
  | 'invalid_payment_terms'
  | 'invalid_vat_rate'
  | 'product_id_required'
  | 'product_not_found'
  | 'quantity_must_be_positive'
  | 'unit_cost_must_be_non_negative'
  | 'unknown';

export class CreatePOError extends Error {
  constructor(public code: CreatePOErrorCode, message?: string) {
    super(message ?? code);
    this.name = 'CreatePOError';
  }
}

export interface CreatePOItemArgs {
  productId: string;
  quantity:  number;
  unit?:     string;
  unitCost:  number;
  notes?:    string;
}

export interface CreatePOArgs {
  supplierId:     string;
  items:          CreatePOItemArgs[];
  expectedDate?:  string;  // YYYY-MM-DD
  orderDate?:     string;  // YYYY-MM-DD
  paymentTerms?:  'cash' | 'credit';
  vatRate?:       number;  // 0..1, default 0.11
  notes?:         string;
}

export interface CreatePOResult {
  po_id:             string;
  po_number:         string;
  subtotal:          number;
  vat_amount:        number;
  total_amount:      number;
  status:            'pending';
  item_count:        number;
  idempotent_replay: boolean;
}

function classify(message: string): CreatePOErrorCode {
  if (message.includes('forbidden'))                       return 'forbidden';
  if (message.includes('supplier_required'))               return 'supplier_required';
  if (message.includes('supplier_not_found'))              return 'supplier_not_found';
  if (message.includes('items_required'))                  return 'items_required';
  if (message.includes('invalid_payment_terms'))           return 'invalid_payment_terms';
  if (message.includes('invalid_vat_rate'))                return 'invalid_vat_rate';
  if (message.includes('product_id_required'))             return 'product_id_required';
  if (message.includes('product_not_found'))               return 'product_not_found';
  if (message.includes('quantity_must_be_positive'))       return 'quantity_must_be_positive';
  if (message.includes('unit_cost_must_be_non_negative'))  return 'unit_cost_must_be_non_negative';
  return 'unknown';
}

export function useCreatePurchaseOrder() {
  const qc = useQueryClient();
  return useMutation<CreatePOResult, CreatePOError, CreatePOArgs>({
    mutationFn: async (args) => {
      const idempotencyKey = crypto.randomUUID();
      const rpcArgs: Record<string, unknown> = {
        p_supplier_id:     args.supplierId,
        p_items: args.items.map((it) => ({
          product_id: it.productId,
          quantity:   it.quantity,
          ...(it.unit  !== undefined && it.unit.trim()  !== '' ? { unit:  it.unit.trim() }  : {}),
          unit_cost:  it.unitCost,
          ...(it.notes !== undefined && it.notes.trim() !== '' ? { notes: it.notes.trim() } : {}),
        })),
        p_payment_terms:   args.paymentTerms ?? 'credit',
        p_vat_rate:        args.vatRate      ?? 0.11,
        p_idempotency_key: idempotencyKey,
      };
      if (args.expectedDate !== undefined && args.expectedDate !== '') {
        rpcArgs['p_expected_date'] = args.expectedDate;
      }
      if (args.orderDate !== undefined && args.orderDate !== '') {
        rpcArgs['p_order_date'] = args.orderDate;
      }
      if (args.notes !== undefined && args.notes.trim() !== '') {
        rpcArgs['p_notes'] = args.notes.trim();
      }

      // create_purchase_order_v1 may not be in types yet — cast through unknown.
      const { data, error } = await (supabase.rpc as unknown as (
        fn: string,
        args: Record<string, unknown>,
      ) => Promise<{ data: unknown; error: { message: string } | null }>)(
        'create_purchase_order_v1',
        rpcArgs,
      );

      if (error !== null) throw new CreatePOError(classify(error.message), error.message);
      if (data === null)  throw new CreatePOError('unknown', 'Empty RPC response');
      return data as CreatePOResult;
    },
    onSuccess: async () => {
      await qc.invalidateQueries({ queryKey: PURCHASE_ORDERS_QUERY_KEY });
    },
  });
}
