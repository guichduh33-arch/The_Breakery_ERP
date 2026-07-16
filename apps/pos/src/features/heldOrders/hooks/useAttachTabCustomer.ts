// apps/pos/src/features/heldOrders/hooks/useAttachTabCustomer.ts
//
// Session 62 — Task 5 — attach a named customer to a fired counter order
// ("ardoise nommée") via `attach_tab_customer_v2` (Task 4, migration
// `20260710000112_retail_tab_credit_gate.sql`). Not yet in
// `types.generated.ts` (types regen deferred to closeout) — the call goes
// through a narrow `LooseSupabase` cast, mirroring `useKdsBumpOrder.ts`.
//
// The RPC raises three business errors as Postgres exceptions:
//   - P0002 'order_not_found' / 'customer_not_found_or_inactive'
//   - P0001 'order_not_attachable: status=..., via=...'
//   - P0011 'credit_limit_exceeded: <json>' with DETAIL = the same json
//     ({allowed, current_outstanding, order_amount, credit_limit,
//     would_exceed_by}).
// `classifyRpcError` turns the raw PostgREST error (message/code/details
// string) into the `{ error, code, message, creditLimit? }` envelope shape
// that `classifyCheckoutError` (packages/domain) already knows how to read
// (`err.details.error` / `err.details.code`), so the same fatal-message
// pattern used by the checkout flow applies here too.

import { useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/lib/supabase';

interface RpcError {
  code?: string;
  message: string;
  details?: string;
}

interface RpcResult {
  data: unknown;
  error: RpcError | null;
}

interface LooseSupabase {
  rpc: (fn: string, args: Record<string, unknown>) => Promise<RpcResult>;
}

const sb = supabase as unknown as LooseSupabase;

export interface CreditLimitExceededDetails {
  allowed: boolean;
  current_outstanding: number;
  order_amount: number;
  credit_limit: number;
  would_exceed_by: number;
}

/** Shape read by `classifyCheckoutError` (packages/domain/src/payment/retryClassifier.ts). */
export interface AttachTabCustomerErrorDetails {
  error: string;
  code?: string;
  message?: string;
  creditLimit?: CreditLimitExceededDetails;
}

export interface AttachTabCustomerResult {
  order_id: string;
  customer_id: string;
  customer_name: string;
  total: number;
  outstanding_before: number;
  credit_limit: number | null;
}

export interface AttachTabCustomerInput {
  orderId: string;
  customerId: string;
}

function classifyRpcError(error: RpcError): Error {
  const msg = error.message ?? '';
  const details: AttachTabCustomerErrorDetails = {
    error: 'unknown',
    message: msg,
    ...(error.code ? { code: error.code } : {}),
  };

  if (msg.includes('credit_limit_exceeded')) {
    details.error = 'credit_limit_exceeded';
    if (error.details) {
      try {
        details.creditLimit = JSON.parse(error.details) as CreditLimitExceededDetails;
      } catch {
        // DETAIL not parsable JSON — surface the raw message only.
      }
    }
  } else if (msg.includes('customer_not_found_or_inactive')) {
    details.error = 'customer_not_found_or_inactive';
  } else if (msg.includes('order_not_found')) {
    details.error = 'order_not_found';
  } else if (msg.includes('order_not_attachable')) {
    details.error = 'order_not_attachable';
  }

  return Object.assign(new Error(msg), { details });
}

export function useAttachTabCustomer() {
  const qc = useQueryClient();

  return useMutation<AttachTabCustomerResult, Error, AttachTabCustomerInput>({
    mutationFn: async ({ orderId, customerId }) => {
      const { data, error } = await sb.rpc('attach_tab_customer_v2', {
        p_order_id: orderId,
        p_customer_id: customerId,
      });
      if (error) throw classifyRpcError(error);
      return data as AttachTabCustomerResult;
    },
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['held-orders'] });
      void qc.invalidateQueries({ queryKey: ['pos-outstanding-debts'] });
    },
  });
}
