// apps/pos/src/features/order-history/hooks/useVoidOrder.ts
//
// Session 10 — POST /void-order EF. Returns the refund_number + restored
// tenders so callers can render the RefundReceiptModal.

import { useMutation, useQueryClient } from '@tanstack/react-query';
import type { PaymentMethod } from '@breakery/domain';
import { supabaseUrl } from '@/lib/supabase';
import { getAccessToken } from '@/lib/accessToken';

interface VoidArgs {
  orderId: string;
  reason: string;
  managerPin: string;
  /** S55 — stable per-modal-open UUID for HTTP retry-safe idempotency. */
  idempotencyKey?: string;
}

export interface VoidResponse {
  order_id: string;
  order_number: string;
  refund_id: string;
  refund_number: string;
  total_refunded: number;
  tax_refunded: number;
  tenders: { method: PaymentMethod; amount: number }[];
  manager: { id: string; full_name: string; role_code: string };
  error?: string;
  message?: string;
}

export function useVoidOrder() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ orderId, reason, managerPin, idempotencyKey }: VoidArgs): Promise<VoidResponse> => {
      const accessToken = await getAccessToken();
      const headers: Record<string, string> = {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${accessToken}`,
        // S34: manager PIN in header, never the body (security-fraud-guard gap 2).
        'x-manager-pin': managerPin,
      };
      // S55: HTTP retry-safe idempotency — the EF forwards this to void_order_rpc_v4.
      if (idempotencyKey) headers['x-idempotency-key'] = idempotencyKey;

      const res = await fetch(`${supabaseUrl}/functions/v1/void-order`, {
        method: 'POST',
        headers,
        body: JSON.stringify({ order_id: orderId, reason }),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({})) as VoidResponse;
        throw Object.assign(new Error(err.error ?? 'void_failed'), { details: err, status: res.status });
      }
      return await res.json() as VoidResponse;
    },
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['order-history'] });
      void qc.invalidateQueries({ queryKey: ['order-detail'] });
      void qc.invalidateQueries({ queryKey: ['products'] });   // stock restored
      void qc.invalidateQueries({ queryKey: ['orders'] });
    },
  });
}
