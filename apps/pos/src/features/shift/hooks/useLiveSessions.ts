// apps/pos/src/features/shift/hooks/useLiveSessions.ts
//
// Session 14 — Phase 2.D — List currently-open POS sessions across terminals.
//
// Read-only query — the modal that surfaces it (LiveSessionsModal) reads
// session id, opened_by, opening_cash, opened_at, and a derived
// transaction count from the `orders` join.

import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/lib/supabase';

export interface LiveSession {
  id: string;
  opening_cash: number;
  opened_at: string;
  opened_by: string;
  cashier_name: string;
  /** Convenience: terminal label (sessions don't have a terminal id yet so we synthesize one from the session uuid). */
  terminal_label: string;
  /** Sum of completed-order totals attached to this session. */
  cash_movements_total: number;
  /** Count of orders attached to this session. */
  order_count: number;
}

interface RawRow {
  id: string;
  opening_cash: number;
  opened_at: string;
  opened_by: string;
  cash_in_total: number;
  cash_out_total: number;
  opened_by_user: { full_name: string | null } | null;
  orders: { count: number }[] | null;
}

export function useLiveSessions() {
  return useQuery<LiveSession[]>({
    queryKey: ['pos-live-sessions'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('pos_sessions')
        .select(
          'id, opening_cash, opened_at, opened_by, cash_in_total, cash_out_total, opened_by_user:user_profiles!pos_sessions_opened_by_fkey(full_name), orders(count)',
        )
        .eq('status', 'open')
        .order('opened_at', { ascending: false });

      if (error) throw new Error(error.message);
      const rows = (data ?? []) as unknown as RawRow[];

      return rows.map((r) => ({
        id: r.id,
        opening_cash: Number(r.opening_cash),
        opened_at: r.opened_at,
        opened_by: r.opened_by,
        cashier_name: r.opened_by_user?.full_name ?? 'Unknown',
        terminal_label: `TERM-${r.id.slice(0, 8).toUpperCase()}`,
        cash_movements_total: Number(r.cash_in_total) - Number(r.cash_out_total),
        order_count: r.orders?.[0]?.count ?? 0,
      }));
    },
    staleTime: 30_000,
    refetchInterval: 30_000,
  });
}
