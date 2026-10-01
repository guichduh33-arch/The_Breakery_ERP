import { useMutation, useQueryClient } from '@tanstack/react-query';
import { isCartPaymentLocked } from '@/stores/cartPaymentGuard';
import { useCartStore } from '@/stores/cartStore';
import { supabaseUrl } from '@/lib/supabase';
import { getAccessToken } from '@/lib/accessToken';
import type { UnpaidOrderSnapshot } from './useUnpaidOrderSnapshot';

export interface CancelUnpaidAttempt {
  snapshot: UnpaidOrderSnapshot;
  losses: { id: string; waste_qty: number }[];
  reason: string;
  idempotencyKey: string;
}
export function useCancelUnpaidOrder() {
  const client = useQueryClient();
  return useMutation({
    retry: false,
    mutationFn: async ({ attempt, managerPin }: { attempt: CancelUnpaidAttempt; managerPin: string }) => {
      if (isCartPaymentLocked()) throw new Error('Resume the saved payment before cancelling this order');
      if (useCartStore.getState().pickedUpOrderId !== attempt.snapshot.id) throw new Error('The active order changed');
      const token = await getAccessToken();
      const response = await fetch(`${supabaseUrl}/functions/v1/cancel-unpaid-order`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}`,
          'x-manager-pin': managerPin, 'x-idempotency-key': attempt.idempotencyKey },
        body: JSON.stringify({ order_id: attempt.snapshot.id,
          expected_updated_at: attempt.snapshot.updated_at, expected_items: attempt.snapshot.order_items,
          losses: attempt.losses, reason: attempt.reason }),
      });
      if (!response.ok) {
        const body = await response.json().catch(() => ({})) as { error?: string };
        throw Object.assign(new Error(body.error ?? 'Cancellation failed'), { status: response.status });
      }
      const result = await response.json() as { order_id?: string; status?: string };
      if (result.order_id !== attempt.snapshot.id || result.status !== 'voided') throw new Error('Cancellation could not be confirmed. Retry the same attempt.');
      // Un retour tardif ne doit jamais effacer un nouveau panier.
      if (useCartStore.getState().pickedUpOrderId === attempt.snapshot.id) useCartStore.getState().voidOrder();
      for (const key of ['orders', 'held-orders', 'pending-tablet-orders', 'table_occupancy', 'table_orders', 'kds', 'products']) {
        void client.invalidateQueries({ queryKey: [key] });
      }
      return result;
    },
  });
}
