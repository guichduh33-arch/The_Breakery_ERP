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
 *
 * BUGFIX (held-order lifecycle gap) — also surfaces FIRED-but-unpaid POS orders
 * (`status = 'pending_payment'`, `created_via = 'pos'`) that were never held
 * (`is_held = false`) — e.g. a counter order fired then abandoned, or reopened
 * then left. Without this they had no POS surface at all: not payable from the
 * cart, not voidable (void needs 'paid'), not discardable (discard needed
 * is_held). Now they appear here as "Sent" tabs and can be reopened→paid or
 * discarded via discard_held_order_v1 (widened to cover them in migration
 * 20260710000027).
 */
export function useHeldOrdersQuery() {
  return useQuery({
    queryKey: ['held-orders'],
    queryFn: async (): Promise<HeldOrderRow[]> => {
      const { data, error } = await supabase
        .from('orders')
        .select('id, order_number, table_number, notes, total, created_at, status, sent_to_kitchen_at')
        .or('is_held.eq.true,and(status.eq.pending_payment,created_via.eq.pos)')
        .order('created_at', { ascending: false });
      if (error) throw error;
      return (data ?? []) as HeldOrderRow[];
    },
  });
}
