// apps/pos/src/features/order-history/hooks/useRetryOrderJournal.ts
//
// Session 13 / Phase 4.A — one-click retry for a paid order whose sale JE
// trigger failed. Calls `retry_sale_journal_entry_v1(p_order_id)` and invalidates
// the order-retry-status query so the banner disappears on success.

import { useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/lib/supabase';

export interface RetryOrderJournalResponse {
  order_id: string;
  journal_entry_id: string;
  created: boolean;
  idempotent_replay: boolean;
}

export function useRetryOrderJournal() {
  const queryClient = useQueryClient();
  return useMutation<RetryOrderJournalResponse, Error, string>({
    mutationFn: async (orderId: string): Promise<RetryOrderJournalResponse> => {
      const { data, error } = await supabase.rpc('retry_sale_journal_entry_v1', {
        p_order_id: orderId,
      });
      if (error) throw Object.assign(new Error(error.message), { details: error });
      return data as unknown as RetryOrderJournalResponse;
    },
    onSuccess: (_data, orderId) => {
      void queryClient.invalidateQueries({ queryKey: ['order-retry-status', orderId] });
      void queryClient.invalidateQueries({ queryKey: ['order-detail', orderId] });
    },
  });
}
