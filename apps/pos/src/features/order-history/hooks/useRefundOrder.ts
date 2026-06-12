// apps/pos/src/features/order-history/hooks/useRefundOrder.ts
//
// Session 10 — POST /refund-order EF for partial line refund + per-tender split.

import { useMutation, useQueryClient } from '@tanstack/react-query';
import type { PaymentMethod } from '@breakery/domain';
import { supabaseUrl } from '@/lib/supabase';
import { getAccessToken } from '@/lib/accessToken';

interface RefundArgs {
  orderId: string;
  lines: { order_item_id: string; qty: number }[];
  tenders: { method: PaymentMethod; amount: number; reference?: string }[];
  reason: string;
  managerPin: string;
  idempotencyKey?: string;
}

export interface RefundResponse {
  refund_id: string;
  refund_number: string;
  order_id: string;
  order_number: string;
  total_refunded: number;
  tax_refunded: number;
  tenders: { method: PaymentMethod; amount: number }[];
  pts_deducted: number;
  manager: { id: string; full_name: string; role_code: string };
  error?: string;
  message?: string;
}

export function useRefundOrder() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ orderId, lines, tenders, reason, managerPin, idempotencyKey }: RefundArgs): Promise<RefundResponse> => {
      const accessToken = await getAccessToken();
      const headers: Record<string, string> = {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${accessToken}`,
        'x-manager-pin': managerPin,
      };
      if (idempotencyKey) headers['x-idempotency-key'] = idempotencyKey;

      const res = await fetch(`${supabaseUrl}/functions/v1/refund-order`, {
        method: 'POST',
        headers,
        body: JSON.stringify({
          order_id: orderId,
          lines,
          tenders,
          reason,
        }),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({})) as RefundResponse;
        throw Object.assign(new Error(err.error ?? 'refund_failed'), { details: err, status: res.status });
      }
      return await res.json() as RefundResponse;
    },
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['order-history'] });
      void qc.invalidateQueries({ queryKey: ['order-detail'] });
      void qc.invalidateQueries({ queryKey: ['products'] });
      void qc.invalidateQueries({ queryKey: ['orders'] });
    },
  });
}
