// apps/backoffice/src/features/inventory-transfers/hooks/useReceiveTransfer.ts
//
// Session 12 — Phase 3 — calls `receive_internal_transfer_v1` RPC. Closes
// out a pending/in_transit transfer with possibly partial quantities. On
// success invalidates the detail (so the status flips to "received"),
// the list, and the global stock-levels cache (movements emitted by the
// server change current_stock).
//
// Server-side errors (see migration 20260516000023):
//   forbidden                       — missing inventory.transfer.receive
//   transfer_not_found              — bad p_transfer_id
//   receive_not_allowed_in_status   — status is not pending/in_transit
//   quantity_received_invalid       — qty < 0 or qty > qty_requested
//   item_id_required                — empty/missing item_id
//   received_items_required         — empty items array
//   transfer_item_not_found         — item_id doesn't belong to this transfer

import { useMutation, useQueryClient } from '@tanstack/react-query';
import type { TransferRpcResult } from '@breakery/domain';
import { supabase } from '@/lib/supabase.js';
import { INTERNAL_TRANSFERS_QUERY_KEY } from './useInternalTransfers.js';
import { transferDetailQueryKey } from './useTransferDetail.js';
import { STOCK_LEVELS_QUERY_KEY } from '@/features/inventory/hooks/useStockLevels.js';

export type ReceiveTransferErrorCode =
  | 'forbidden'
  | 'transfer_not_found'
  | 'receive_not_allowed_in_status'
  | 'quantity_received_invalid'
  | 'unknown';

export class ReceiveTransferError extends Error {
  constructor(public code: ReceiveTransferErrorCode, message?: string) {
    super(message ?? code);
    this.name = 'ReceiveTransferError';
  }
}

export interface ReceiveTransferArgs {
  transferId: string;
  items: {
    itemId:           string;
    quantityReceived: number;
  }[];
}

function classify(message: string): ReceiveTransferErrorCode {
  if (message.includes('forbidden'))                     return 'forbidden';
  if (message.includes('transfer_not_found') ||
      message.includes('transfer_item_not_found'))       return 'transfer_not_found';
  if (message.includes('receive_not_allowed_in_status')) return 'receive_not_allowed_in_status';
  if (message.includes('quantity_received_invalid') ||
      message.includes('item_id_required') ||
      message.includes('received_items_required'))       return 'quantity_received_invalid';
  return 'unknown';
}

export function useReceiveTransfer() {
  const qc = useQueryClient();
  return useMutation<TransferRpcResult, ReceiveTransferError, ReceiveTransferArgs>({
    mutationFn: async (args) => {
      const idempotencyKey = crypto.randomUUID();
      const rpcArgs = {
        p_transfer_id:    args.transferId,
        p_received_items: args.items.map((it) => ({
          item_id:           it.itemId,
          quantity_received: it.quantityReceived,
        })),
        p_idempotency_key: idempotencyKey,
      };

      const { data, error } = await (supabase.rpc as unknown as (
        fn: string,
        args: Record<string, unknown>,
      ) => Promise<{ data: unknown; error: { message: string } | null }>)(
        'receive_internal_transfer_v1',
        rpcArgs,
      );

      if (error !== null) throw new ReceiveTransferError(classify(error.message), error.message);
      if (data === null)  throw new ReceiveTransferError('unknown', 'Empty RPC response');
      return data as TransferRpcResult;
    },
    onSuccess: async (_data, vars) => {
      await Promise.all([
        qc.invalidateQueries({ queryKey: transferDetailQueryKey(vars.transferId) }),
        qc.invalidateQueries({ queryKey: INTERNAL_TRANSFERS_QUERY_KEY }),
        qc.invalidateQueries({ queryKey: STOCK_LEVELS_QUERY_KEY }),
      ]);
    },
  });
}
