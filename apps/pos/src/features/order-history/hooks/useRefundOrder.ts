// apps/pos/src/features/order-history/hooks/useRefundOrder.ts
//
// Session 10 — POST /refund-order EF for partial line refund + per-tender split.

import { useMutation, useQueryClient } from '@tanstack/react-query';
import type { PaymentMethod } from '@breakery/domain';
import { supabaseUrl } from '@/lib/supabase';
import { getAccessToken } from '@/lib/accessToken';
import { FinancialAttemptError } from '@breakery/utils';
import { captureRefundSession } from './useRefundAttempt';
import { finite, identifier, isRecord } from './refundRecovery';
import { PAYMENT_METHODS } from '@breakery/supabase';

interface RefundArgs {
  orderId: string;
  lines: { order_item_id: string; qty: number }[];
  tenders: { method: PaymentMethod; amount: number; reference?: string }[];
  reason: string;
  managerPin: string;
  idempotencyKey?: string;
  sessionGuard?: (() => boolean) | undefined;
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
    retry: false,
    onMutate: () => captureRefundSession(),
    mutationFn: async ({ orderId, lines, tenders, reason, managerPin, idempotencyKey, sessionGuard }: RefundArgs): Promise<RefundResponse> => {
      const session = captureRefundSession();
      const accessToken = await getAccessToken();
      if (!session.current() || sessionGuard?.() === false) throw new FinancialAttemptError('Your session changed. Reopen this form.');
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
        const err: unknown = await res.json().catch(() => null);
        const code = isRecord(err) && typeof err.error === 'string' ? err.error : undefined;
        throw Object.assign(new FinancialAttemptError(code ?? 'refund_failed', definitiveRefundFailure(code, res.status)), { details: err, status: res.status });
      }
      const data: unknown = await res.json();
      if (!isRecord(data) || data.error !== undefined || !identifier(data.refund_id) || !identifier(data.refund_number) || data.order_id !== orderId
        || !identifier(data.order_number) || !finite(data.total_refunded) || data.total_refunded <= 0
        || !finite(data.tax_refunded) || data.tax_refunded < 0 || !Array.isArray(data.tenders)
        || data.tenders.length === 0 || !data.tenders.every((t: unknown) => isRecord(t) && PAYMENT_METHODS.some((m) => m === t.method) && finite(t.amount) && t.amount > 0)
        || (data.idempotent_replay !== undefined && typeof data.idempotent_replay !== 'boolean')) {
        throw new FinancialAttemptError('The refund response was invalid. Its result is unconfirmed.');
      }
      return data as unknown as RefundResponse;
    },
    onSuccess: (_, { sessionGuard }, session) => {
      if (!session?.current() || sessionGuard?.() === false) return;
      void qc.invalidateQueries({ queryKey: ['order-history'] });
      void qc.invalidateQueries({ queryKey: ['order-detail'] });
      void qc.invalidateQueries({ queryKey: ['products'] });
      void qc.invalidateQueries({ queryKey: ['orders'] });
    },
  });
}

function definitiveRefundFailure(code: string | undefined, status: number): boolean {
  const failures: Record<string, number> = {
    missing_manager_pin: 400, invalid_pin_format: 400, wrong_pin: 401,
    authorization_required: 401, not_authenticated: 401, permission_denied: 403,
    invalid_json: 400, invalid_order_id: 400, no_lines: 400, invalid_line: 400,
    no_tenders: 400, invalid_tender: 400, reason_too_short: 400, not_found: 404,
    cross_shift_not_allowed: 422, store_credit_requires_customer: 422,
    cash_refund_requires_open_session: 422, check_violation: 422,
  };
  return code !== undefined && failures[code] === status;
}
