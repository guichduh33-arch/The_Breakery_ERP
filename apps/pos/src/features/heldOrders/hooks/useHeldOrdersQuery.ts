import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/lib/supabase';

export interface HeldOrderRow {
  id: string;
  order_number: string;
  table_number: string | null;
  notes: string | null;
  total: number;
  created_at: string;
  status: string;
  sent_to_kitchen_at: string | null;
}

/**
 * Session 35 (F-003) — DB-backed held orders list. Reads every order flagged
 * `is_held = true`, newest first. Replaces the localStorage `heldOrdersStore`
 * read path (the store is retired in the follow-up UI task).
 */
export function useHeldOrdersQuery() {
  return useQuery({
    queryKey: ['held-orders'],
    queryFn: async (): Promise<HeldOrderRow[]> => {
      const { data, error } = await supabase
        .from('orders')
        .select('id, order_number, table_number, notes, total, created_at, status, sent_to_kitchen_at')
        .eq('is_held', true)
        .order('created_at', { ascending: false });
      if (error) throw error;
      return (data ?? []) as HeldOrderRow[];
    },
  });
}
