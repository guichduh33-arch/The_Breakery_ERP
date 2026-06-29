// apps/backoffice/src/features/btob/hooks/useCancelB2bOrder.ts
//
// Session 52 / P1.2 — call cancel_b2b_order_v1 (migration _068).
//
// Cancels an UNPAID b2b invoice: the RPC reverses the creation JE
// (DR revenue / CR AR), restores stock (sale_void), decrements the customer's
// cached balance and sets the order status='voided'. It is BLOCKED when any
// allocation exists (order_has_payments) — the user must handle the payment
// first. Idempotent via p_idempotency_key. Gate b2b.order.cancel.

import { useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/lib/supabase.js';
import { B2B_DASHBOARD_QUERY_KEY } from './useB2bDashboard.js';

export type CancelB2bOrderErrorCode =
  | 'not_authenticated'
  | 'permission_denied'
  | 'order_not_found'
  | 'not_a_b2b_order'
  | 'order_not_cancellable'
  | 'order_has_payments'
  | 'reason_required'
  | 'fiscal_period_closed'
  | 'unknown';

export class CancelB2bOrderError extends Error {
  constructor(public code: CancelB2bOrderErrorCode, message?: string) {
    super(message ?? code);
    this.name = 'CancelB2bOrderError';
  }
}

export interface CancelB2bOrderArgs {
  orderId:        string;
  reason:         string;
  idempotencyKey: string;
}

export interface CancelB2bOrderResult {
  order_id:          string;
  order_number:      string;
  reversed_je_id:    string;
  balance_after:     number;
  idempotent_replay: boolean;
}

function classify(message: string): CancelB2bOrderErrorCode {
  if (message.includes('order_has_payments'))     return 'order_has_payments';
  if (message.includes('order_not_cancellable'))  return 'order_not_cancellable';
  if (message.includes('not_a_b2b_order'))        return 'not_a_b2b_order';
  if (message.includes('order_not_found'))        return 'order_not_found';
  if (message.includes('reason_required'))        return 'reason_required';
  if (message.includes('permission_denied'))      return 'permission_denied';
  if (message.includes('not_authenticated'))      return 'not_authenticated';
  if (message.includes('fiscal_period'))          return 'fiscal_period_closed';
  return 'unknown';
}

export function useCancelB2bOrder() {
  const qc = useQueryClient();
  return useMutation<CancelB2bOrderResult, CancelB2bOrderError, CancelB2bOrderArgs>({
    mutationFn: async (args) => {
      const { data, error } = await supabase.rpc('cancel_b2b_order_v1', {
        p_order_id:        args.orderId,
        p_reason:          args.reason,
        p_idempotency_key: args.idempotencyKey,
      });
      if (error) throw new CancelB2bOrderError(classify(error.message), error.message);
      if (data === null) throw new CancelB2bOrderError('unknown', 'Empty RPC response');
      return data as unknown as CancelB2bOrderResult;
    },
    onSuccess: async () => {
      await Promise.all([
        qc.invalidateQueries({ queryKey: B2B_DASHBOARD_QUERY_KEY }),
        qc.invalidateQueries({ queryKey: ['customers'] }),
        qc.invalidateQueries({ queryKey: ['b2b-invoices'] }),
      ]);
    },
  });
}
