// apps/backoffice/src/features/inventory-transfers/hooks/useCreateTransfer.ts
//
// Session 12 — Phase 3 — calls `create_internal_transfer_v1` RPC. Generates
// a fresh idempotency UUID per call so retries replay idempotently. Maps
// server error messages to a closed set of typed codes so the form can
// render friendly per-case copy.
//
// Server-side errors (see migration 20260516000023):
//   forbidden                       — missing inventory.transfer.create
//   from_to_same_section            — From == To
//   section_not_found               — one or both sections deleted/inactive
//   items_required                  — empty items array
//   duplicate_product_in_items      — same product twice
//   product_not_found               — product deleted or inactive
//   quantity_must_be_positive       — qty <= 0

import { useRef } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import type { TransferRpcResult } from '@breakery/domain';
import { supabase } from '@/lib/supabase.js';
import { INTERNAL_TRANSFERS_QUERY_KEY } from './useInternalTransfers.js';

export type CreateTransferErrorCode =
  | 'forbidden'
  | 'from_to_same_section'
  | 'section_not_found'
  | 'items_required'
  | 'duplicate_product_in_items'
  | 'product_not_found'
  | 'quantity_must_be_positive'
  | 'unknown';

export class CreateTransferError extends Error {
  constructor(public code: CreateTransferErrorCode, message?: string) {
    super(message ?? code);
    this.name = 'CreateTransferError';
  }
}

export interface CreateTransferArgs {
  fromSectionId:  string;
  toSectionId:    string;
  items: {
    productId: string;
    quantity:  number;
    unit?:     string;
    notes?:    string;
  }[];
  notes?:        string;
  sendDirectly?: boolean;
}

function classify(message: string): CreateTransferErrorCode {
  if (message.includes('forbidden'))                   return 'forbidden';
  if (message.includes('from_to_same_section'))        return 'from_to_same_section';
  if (message.includes('section_not_found') ||
      message.includes('section_required'))            return 'section_not_found';
  if (message.includes('items_required'))              return 'items_required';
  if (message.includes('duplicate_product_in_items'))  return 'duplicate_product_in_items';
  if (message.includes('product_not_found') ||
      message.includes('product_id_required'))         return 'product_not_found';
  if (message.includes('quantity_must_be_positive'))   return 'quantity_must_be_positive';
  return 'unknown';
}

export function useCreateTransfer() {
  const qc = useQueryClient();
  // Idempotency key held across retries (a network retry of THIS transfer replays
  // server-side); rotated on success so the next logical transfer gets a fresh key.
  const idemKey = useRef<string>(crypto.randomUUID());
  return useMutation<TransferRpcResult, CreateTransferError, CreateTransferArgs>({
    mutationFn: async (args) => {
      const idempotencyKey = idemKey.current;
      const rpcArgs = {
        p_from_section_id: args.fromSectionId,
        p_to_section_id:   args.toSectionId,
        p_items: args.items.map((it) => ({
          product_id: it.productId,
          quantity:   it.quantity,
          ...(it.unit  !== undefined && it.unit.trim()  !== '' ? { unit:  it.unit.trim() }  : {}),
          ...(it.notes !== undefined && it.notes.trim() !== '' ? { notes: it.notes.trim() } : {}),
        })),
        ...(args.notes !== undefined && args.notes.trim() !== '' ? { p_notes: args.notes.trim() } : {}),
        p_send_directly:   args.sendDirectly === true,
        p_idempotency_key: idempotencyKey,
      };

      // `create_internal_transfer_v1` is not yet in `types.generated.ts`;
      // cast through `unknown` to call it like any other RPC.
      const { data, error } = await (supabase.rpc as unknown as (
        fn: string,
        args: Record<string, unknown>,
      ) => Promise<{ data: unknown; error: { message: string } | null }>)(
        'create_internal_transfer_v1',
        rpcArgs,
      );

      if (error !== null) throw new CreateTransferError(classify(error.message), error.message);
      if (data === null)  throw new CreateTransferError('unknown', 'Empty RPC response');
      return data as TransferRpcResult;
    },
    onSuccess: async () => {
      idemKey.current = crypto.randomUUID();
      await qc.invalidateQueries({ queryKey: INTERNAL_TRANSFERS_QUERY_KEY });
    },
  });
}
