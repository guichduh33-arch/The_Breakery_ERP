// apps/backoffice/src/features/orders/hooks/useVoidOrder.ts
// Session 33 / Wave 2.5 — BO version of POS apps/pos/src/features/order-history/hooks/useVoidOrder.
// S34 hardening: the void-order EF reads the manager PIN ONLY from the
// `x-manager-pin` HTTP header (S25 PIN-in-header pattern) and rejects with
// `missing_manager_pin` (400) when it is absent — never from the JSON body.

import { useMutation, useQueryClient } from '@tanstack/react-query';
import { getAccessToken } from '@/lib/accessToken.js';

interface VoidArgs {
  orderId:    string;
  reason:     string;
  managerPin: string;
  /** S55 parity — stable per-modal-open UUID for HTTP retry-safe idempotency. */
  idempotencyKey?: string;
}

export interface VoidResponse {
  order_id:       string;
  order_number:   string;
  refund_id:      string;
  refund_number:  string;
  total_refunded: number;
  tax_refunded:   number;
  error?:         string;
  message?:       string;
}

export function useVoidOrder() {
  const qc = useQueryClient();
  const supabaseUrl = import.meta.env.VITE_SUPABASE_URL as string;

  return useMutation({
    mutationFn: async ({ orderId, reason, managerPin, idempotencyKey }: VoidArgs): Promise<VoidResponse> => {
      const accessToken = await getAccessToken();
      const headers: Record<string, string> = {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${accessToken}`,
        'x-manager-pin': managerPin,
      };
      // S55 parity: HTTP retry-safe idempotency — the EF forwards this to void_order_rpc_v14.
      if (idempotencyKey) headers['x-idempotency-key'] = idempotencyKey;

      const res = await fetch(`${supabaseUrl}/functions/v1/void-order`, {
        method: 'POST',
        headers,
        body: JSON.stringify({ order_id: orderId, reason, source: 'backoffice' }),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({})) as VoidResponse;
        const message = err.error === 'outstanding_prior_day_requires_refund'
          ? 'Use Refund for an Outstanding ticket from an earlier business day. The original sale must be kept.'
          : err.error ?? 'void_failed';
        throw Object.assign(new Error(message), { details: err, status: res.status });
      }
      return await res.json() as VoidResponse;
    },
    onSuccess: (_, { orderId }) => {
      void qc.invalidateQueries({ queryKey: ['orders', 'list'] });
      void qc.invalidateQueries({ queryKey: ['order-detail', orderId] });
    },
  });
}
