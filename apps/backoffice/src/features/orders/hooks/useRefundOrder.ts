// apps/backoffice/src/features/orders/hooks/useRefundOrder.ts
//
// Lot 6c — version BO du remboursement partiel, calquée sur
// apps/pos/src/features/order-history/hooks/useRefundOrder + le patron d'erreurs
// de features/orders/hooks/useVoidOrder.
//
// L'EF `refund-order` appelle la famille refund_order_rpc (socle lot 6b) : depuis le BO,
// l'opérateur n'a PAS de session ouverte → seuls les tenders non-cash et
// store_credit sont acceptés. Le cash cross-shift répond 422
// `cash_refund_requires_open_session` (P0016) ; store_credit sans client répond
// 422 `store_credit_requires_customer` (P0015). Le PIN manager voyage dans
// l'en-tête `x-manager-pin` (S25), jamais dans le corps ; la clé d'idempotence
// dans `x-idempotency-key` (retry-safe).

import { useMutation, useQueryClient } from '@tanstack/react-query';
import { getAccessToken } from '@/lib/accessToken.js';
import { FinancialAttemptError } from '@/lib/pendingFinancialAttempts.js';
import { finite, identifier, isRecord } from '@/lib/pendingFinancialAttemptSchema.js';
import { captureFinancialSession } from '@/lib/useFinancialAttempt.js';

export interface RefundLineArg {
  order_item_id: string;
  qty: number;
}

export interface RefundTenderArg {
  method: string;
  amount: number;
  reference?: string;
}

interface RefundArgs {
  orderId: string;
  lines: RefundLineArg[];
  tenders: RefundTenderArg[];
  reason: string;
  managerPin: string;
  /** UUID durable de la tentative, conservé tant que son résultat est incertain. */
  idempotencyKey?: string;
  sessionGuard?: () => boolean;
}

export interface RefundResponse {
  refund_id: string;
  refund_number: string;
  order_id: string;
  order_number?: string;
  total_refunded: number;
  tax_refunded: number;
  tenders?: { method: string; amount: number }[];
  manager?: { id: string; full_name: string; role_code: string };
  error?: string;
  message?: string;
}

/** Traduit un code d'erreur EF en message lisible pour la modale. */
export function refundErrorMessage(code: string | undefined, status: number | undefined): string {
  switch (code) {
    case 'cash_refund_requires_open_session':
      return 'Cash refunds require an open register (POS). Choose a non-cash tender or store credit.';
    case 'store_credit_requires_customer':
      return 'Store credit refunds require a customer on this order.';
    case 'cross_shift_not_allowed':
      return 'This refund is not allowed from the back-office for the current shift.';
    case 'permission_denied':
      return 'You do not have permission to refund orders.';
    case 'wrong_pin':
      return 'Incorrect manager PIN.';
    case 'invalid_pin_format':
      return 'Manager PIN must be 6 digits.';
    case 'not_found':
      return 'Order not found.';
    case 'check_violation':
      return 'The refund exceeds what remains refundable on this order.';
    case 'loyalty_points_unavailable':
      return 'Not enough loyalty points are available to reverse this sale, including restored points. No changes were made.';
    default:
      if (status === 429) return 'Too many attempts. Please wait and try again.';
      return code ?? 'Refund failed. Please try again.';
  }
}

export function useRefundOrder() {
  const qc = useQueryClient();
  const supabaseUrl = import.meta.env.VITE_SUPABASE_URL as string;

  return useMutation({
    retry: false,
    meta: { errorHandled: true },
    onMutate: () => captureFinancialSession(),
    mutationFn: async ({ orderId, lines, tenders, reason, managerPin, idempotencyKey, sessionGuard }: RefundArgs): Promise<RefundResponse> => {
      const session = captureFinancialSession();
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
        body: JSON.stringify({ order_id: orderId, lines, tenders, reason }),
      });
      if (!res.ok) {
        const err: unknown = await res.json().catch(() => null);
        const code = isRecord(err) && typeof err.error === 'string' ? err.error : undefined;
        throw Object.assign(new FinancialAttemptError(refundErrorMessage(code, res.status),
          refundDefinitiveFailure(code, res.status)), {
          code,
          status: res.status,
        });
      }
      const data: unknown = await res.json();
      const pointsOnly = isRecord(data) && data.total_refunded === 0 && data.tax_refunded === 0
        && finite(data.pts_restored) && Number.isInteger(data.pts_restored) && data.pts_restored > 0
        && Array.isArray(data.tenders) && data.tenders.length === 0;
      if (!isRecord(data) || !identifier(data.refund_id) || !identifier(data.refund_number)
        || data.order_id !== orderId || !finite(data.total_refunded) || (data.total_refunded <= 0 && !pointsOnly)
        || !finite(data.tax_refunded) || data.tax_refunded < 0
        || (data.idempotent_replay !== undefined && typeof data.idempotent_replay !== 'boolean')) {
        throw new FinancialAttemptError('The refund response was invalid. Its result is unconfirmed.');
      }
      return data as unknown as RefundResponse;
    },
    onSuccess: (_, { orderId, sessionGuard }, session) => {
      if (!session?.current() || sessionGuard?.() === false) return;
      // Ciblé : la liste (compteurs + refund_status computed), le détail de la
      // commande (carte Refunds), et le stock (le refund restitue l'inventaire).
      void qc.invalidateQueries({ queryKey: ['orders', 'list'] });
      void qc.invalidateQueries({ queryKey: ['order-detail', orderId] });
      void qc.invalidateQueries({ queryKey: ['products'] });
    },
  });
}

/** Codes rendus avant écriture, ou erreurs SQL qui annulent toute la transaction. */
export function refundDefinitiveFailure(code: string | undefined, status: number): boolean {
  const failures: Record<string, number> = {
    missing_manager_pin: 400, invalid_pin_format: 400, wrong_pin: 401,
    authorization_required: 401, not_authenticated: 401, permission_denied: 403,
    invalid_json: 400, invalid_order_id: 400, no_lines: 400, invalid_line: 400,
    no_tenders: 400, invalid_tender: 400, reason_too_short: 400,
    not_found: 404, cross_shift_not_allowed: 422, store_credit_requires_customer: 422,
    cash_refund_requires_open_session: 422, check_violation: 422, loyalty_points_unavailable: 422,
  };
  return code !== undefined && failures[code] === status;
}
