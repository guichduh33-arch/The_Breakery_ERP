// apps/backoffice/src/features/orders/hooks/useRefundOrder.ts
//
// Lot 6c — version BO du remboursement partiel, calquée sur
// apps/pos/src/features/order-history/hooks/useRefundOrder + le patron d'erreurs
// de features/orders/hooks/useVoidOrder.
//
// L'EF `refund-order` appelle refund_order_rpc_v11 (socle lot 6b) : depuis le BO,
// l'opérateur n'a PAS de session ouverte → seuls les tenders non-cash et
// store_credit sont acceptés. Le cash cross-shift répond 422
// `cash_refund_requires_open_session` (P0016) ; store_credit sans client répond
// 422 `store_credit_requires_customer` (P0015). Le PIN manager voyage dans
// l'en-tête `x-manager-pin` (S25), jamais dans le corps ; la clé d'idempotence
// dans `x-idempotency-key` (retry-safe).

import { useMutation, useQueryClient } from '@tanstack/react-query';
import { getAccessToken } from '@/lib/accessToken.js';

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
  /** UUID stable par ouverture de modale — idempotence HTTP retry-safe. */
  idempotencyKey?: string;
}

export interface RefundResponse {
  refund_id: string;
  refund_number: string;
  order_id: string;
  order_number: string;
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
    default:
      if (status === 429) return 'Too many attempts. Please wait and try again.';
      return code ?? 'Refund failed. Please try again.';
  }
}

export function useRefundOrder() {
  const qc = useQueryClient();
  const supabaseUrl = import.meta.env.VITE_SUPABASE_URL as string;

  return useMutation<RefundResponse, Error, RefundArgs>({
    mutationFn: async ({ orderId, lines, tenders, reason, managerPin, idempotencyKey }): Promise<RefundResponse> => {
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
        body: JSON.stringify({ order_id: orderId, lines, tenders, reason }),
      });
      if (!res.ok) {
        const err = (await res.json().catch(() => ({}))) as RefundResponse;
        throw Object.assign(new Error(refundErrorMessage(err.error, res.status)), {
          code: err.error,
          status: res.status,
        });
      }
      return (await res.json()) as RefundResponse;
    },
    onSuccess: (_, { orderId }) => {
      // Ciblé : la liste (compteurs + refund_status computed), le détail de la
      // commande (carte Refunds), et le stock (le refund restitue l'inventaire).
      void qc.invalidateQueries({ queryKey: ['orders', 'list'] });
      void qc.invalidateQueries({ queryKey: ['order-detail', orderId] });
      void qc.invalidateQueries({ queryKey: ['products'] });
    },
  });
}
