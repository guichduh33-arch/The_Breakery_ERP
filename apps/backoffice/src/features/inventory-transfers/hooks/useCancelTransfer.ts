// apps/backoffice/src/features/inventory-transfers/hooks/useCancelTransfer.ts
//
// Session 12 — Phase 3 — calls `cancel_internal_transfer_v1` RPC. Cancellation
// is only allowed in draft/pending; once a transfer is in_transit or received
// the server returns `cancel_not_allowed_in_status`.
//
// Server-side errors (see migration 20260516000023):
//   forbidden                       — missing inventory.transfer.create
//   transfer_not_found              — bad p_transfer_id
//   reason_required                 — reason < 3 chars
//   cancel_not_allowed_in_status    — status not in {draft, pending}

import { useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/lib/supabase.js';
import { INTERNAL_TRANSFERS_QUERY_KEY } from './useInternalTransfers.js';
import { transferDetailQueryKey } from './useTransferDetail.js';

export type CancelTransferErrorCode =
  | 'forbidden'
  | 'transfer_not_found'
  | 'reason_required'
  | 'cancel_not_allowed_in_status'
  | 'unknown';

export class CancelTransferError extends Error {
  constructor(public code: CancelTransferErrorCode, message?: string) {
    super(message ?? code);
    this.name = 'CancelTransferError';
  }
}

export interface CancelTransferArgs {
  transferId: string;
  reason:     string;
}

export interface CancelTransferResult {
  transfer_id:   string;
  status:        'cancelled';
  cancel_reason: string;
}

function classify(message: string): CancelTransferErrorCode {
  if (message.includes('forbidden'))                    return 'forbidden';
  if (message.includes('transfer_not_found'))           return 'transfer_not_found';
  if (message.includes('reason_required'))              return 'reason_required';
  if (message.includes('cancel_not_allowed_in_status')) return 'cancel_not_allowed_in_status';
  return 'unknown';
}

export function useCancelTransfer() {
  const qc = useQueryClient();
  return useMutation<CancelTransferResult, CancelTransferError, CancelTransferArgs>({
    mutationFn: async (args) => {
      const rpcArgs = {
        p_transfer_id: args.transferId,
        p_reason:      args.reason.trim(),
      };

      const { data, error } = await (supabase.rpc as unknown as (
        fn: string,
        args: Record<string, unknown>,
      ) => Promise<{ data: unknown; error: { message: string } | null }>)(
        'cancel_internal_transfer_v1',
        rpcArgs,
      );

      if (error !== null) throw new CancelTransferError(classify(error.message), error.message);
      if (data === null)  throw new CancelTransferError('unknown', 'Empty RPC response');
      return data as CancelTransferResult;
    },
    onSuccess: async (_data, vars) => {
      await Promise.all([
        qc.invalidateQueries({ queryKey: transferDetailQueryKey(vars.transferId) }),
        qc.invalidateQueries({ queryKey: INTERNAL_TRANSFERS_QUERY_KEY }),
      ]);
    },
  });
}
