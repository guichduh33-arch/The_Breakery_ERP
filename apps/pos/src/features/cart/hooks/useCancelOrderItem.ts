// apps/pos/src/features/cart/hooks/useCancelOrderItem.ts
//
// Session 10 — call the cancel-item Edge Function with the cashier JWT, manager
// PIN, and the line's order_item_id. On success, mark the cart line as
// cancelled (so the panel renders strikethrough) and invalidate the KDS query
// so chefs see the cancellation in <1s via realtime.

import { useMutation, useQueryClient } from '@tanstack/react-query';
import { supabaseUrl } from '@/lib/supabase';
import { getAccessToken } from '@/lib/accessToken';
import { useCartStore } from '@/stores/cartStore';

interface CancelItemArgs {
  /** order_items.id (DB UUID). Tablet pickup loads these onto cart lines. */
  orderItemId: string;
  reason: string;
  managerPin: string;
}

interface CancelItemResponse {
  order_item_id: string;
  order_id: string;
  order_number: string;
  item_name: string;
  dispatch_station: string | null;
  new_subtotal: number;
  new_tax_amount: number;
  new_total: number;
  manager: { id: string; full_name: string; role_code: string };
  error?: string;
  message?: string;
}

export function useCancelOrderItem() {
  const qc = useQueryClient();
  const markCancelled = useCartStore((s) => s.markCancelled);

  return useMutation({
    mutationFn: async ({ orderItemId, reason, managerPin }: CancelItemArgs): Promise<CancelItemResponse> => {
      const accessToken = await getAccessToken();
      const res = await fetch(`${supabaseUrl}/functions/v1/cancel-item`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${accessToken}`,
          // S34: manager PIN in header, never the body (security-fraud-guard gap 2).
          'x-manager-pin': managerPin,
        },
        body: JSON.stringify({
          order_item_id: orderItemId,
          reason,
        }),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({})) as CancelItemResponse;
        throw Object.assign(new Error(err.error ?? 'cancel_failed'), {
          details: err,
          status: res.status,
        });
      }
      return await res.json() as CancelItemResponse;
    },
    onSuccess: (_data, vars) => {
      // Local mirror — cart panel renders the cancelled state immediately.
      markCancelled(vars.orderItemId);
      // Invalidate KDS queries so the realtime path is backed by a refetch.
      void qc.invalidateQueries({ queryKey: ['kds'] });
      void qc.invalidateQueries({ queryKey: ['orders'] });
    },
  });
}
