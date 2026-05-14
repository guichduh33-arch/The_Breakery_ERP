// apps/pos/src/features/display/hooks/useDisplayOrders.ts
//
// Session 13 / Phase 4.C — D-4C-5.
//
// Fetch the most recent 5 orders for the customer-display queue ticker.
// Filters:
//   - `status IN ('paid', 'completed')` — excludes draft / voided / pending_payment.
//   - `paid_at >= now() - interval '15 minutes'` — only fresh orders are
//     interesting on a face-client screen.
// Ordering : `paid_at DESC`. Limit 5.
//
// The TanStack key is shared with `useDisplayRealtime` so realtime events
// invalidate this query and force a re-fetch.

import { useQuery } from '@tanstack/react-query';

import { supabase } from '@/lib/supabase';

import { DISPLAY_ORDERS_QUERY_KEY } from './useDisplayRealtime';

export interface DisplayOrder {
  id: string;
  order_number: string;
  status: string;
  order_type: string;
  total: number;
  table_number: string | null;
  paid_at: string | null;
  created_at: string;
}

const FRESH_WINDOW_MIN = 15;
export const DISPLAY_ORDERS_LIMIT = 5;

export function useDisplayOrders(enabled: boolean = true) {
  return useQuery<DisplayOrder[]>({
    queryKey: DISPLAY_ORDERS_QUERY_KEY,
    enabled,
    queryFn: async () => {
      const sinceIso = new Date(Date.now() - FRESH_WINDOW_MIN * 60_000).toISOString();
      const { data, error } = await supabase
        .from('orders')
        .select(
          'id, order_number, status, order_type, total, table_number, paid_at, created_at',
        )
        .in('status', ['paid', 'completed'])
        .gte('paid_at', sinceIso)
        .order('paid_at', { ascending: false })
        .limit(DISPLAY_ORDERS_LIMIT);
      if (error) throw error;
      return (data ?? []) as DisplayOrder[];
    },
    staleTime: 30_000,
    refetchOnWindowFocus: false,
  });
}
