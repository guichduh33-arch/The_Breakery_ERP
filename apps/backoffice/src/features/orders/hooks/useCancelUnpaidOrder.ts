import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { Database } from '@breakery/supabase';
import { supabase } from '@/lib/supabase.js';
import { getAccessToken } from '@/lib/accessToken.js';

export interface UnpaidOrderSnapshot {
  id: string;
  updated_at: string;
  status: string;
  created_via: string;
  order_number: string;
  order_items: Database['public']['Tables']['order_items']['Row'][];
}
export interface CancelUnpaidAttempt {
  snapshot: UnpaidOrderSnapshot;
  losses: { id: string; waste_qty: number }[];
  reason: string;
  idempotencyKey: string;
}

export function useUnpaidOrderSnapshot(orderId: string | null, enabled: boolean) {
  return useQuery({
    queryKey: ['cancel-unpaid-snapshot', orderId],
    enabled: enabled && orderId !== null,
    staleTime: 0,
    refetchOnWindowFocus: false,
    retry: false,
    queryFn: async (): Promise<UnpaidOrderSnapshot> => {
      if (!orderId) throw new Error('Order required');
      // Le serveur compare toutes les colonnes sous verrou, comme au POS.
      const { data, error } = await supabase.from('orders')
        .select('id, updated_at, status, created_via, order_number, order_items(*)')
        .eq('id', orderId).single();
      if (error) throw error;
      if (!data.updated_at || !['draft', 'pending_payment'].includes(data.status)
        || !['pos', 'tablet'].includes(data.created_via) || !data.order_items.length) {
        throw new Error('Only an unpaid counter or tablet order can be cancelled here');
      }
      return data;
    },
  });
}

export function useCancelUnpaidOrder() {
  const client = useQueryClient();
  return useMutation({
    retry: false,
    mutationFn: async ({ attempt, managerPin }: { attempt: CancelUnpaidAttempt; managerPin: string }) => {
      const token = await getAccessToken();
      const response = await fetch(`${import.meta.env.VITE_SUPABASE_URL}/functions/v1/cancel-unpaid-order`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json', Authorization: `Bearer ${token}`,
          'x-manager-pin': managerPin, 'x-idempotency-key': attempt.idempotencyKey,
        },
        body: JSON.stringify({
          order_id: attempt.snapshot.id, expected_updated_at: attempt.snapshot.updated_at,
          expected_items: attempt.snapshot.order_items, losses: attempt.losses, reason: attempt.reason,
        }),
      });
      if (!response.ok) {
        throw Object.assign(new Error('Cancellation was not confirmed'), { status: response.status });
      }
      const result = await response.json() as { order_id?: string; status?: string };
      if (result.order_id !== attempt.snapshot.id || result.status !== 'voided') {
        throw new Error('Cancellation could not be confirmed. Retry the same attempt.');
      }
      return result;
    },
    onSettled: (_data, _error, { attempt }) => {
      // Même une réponse perdue peut avoir modifié les données serveur.
      void client.invalidateQueries({ queryKey: ['orders'] });
      void client.invalidateQueries({ queryKey: ['order-detail', attempt.snapshot.id] });
    },
  });
}
