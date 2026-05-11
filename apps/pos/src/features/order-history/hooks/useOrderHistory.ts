// apps/pos/src/features/order-history/hooks/useOrderHistory.ts
//
// Session 10 — list paid orders for the current open shift, ordered by paid_at DESC.
// Used by OrderHistoryPanel to surface candidates for void/refund flows.

import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/lib/supabase';
import { useShiftStore } from '@/stores/shiftStore';

export interface OrderHistoryRow {
  id: string;
  order_number: string;
  status: 'paid' | 'voided' | 'draft';
  total: number;
  paid_at: string | null;
  voided_at: string | null;
  customer_id: string | null;
  table_number: string | null;
  /** Sum of refunds.total for this order (audit-only, partials allowed). */
  total_refunded: number;
}

interface RawOrderRow {
  id: string;
  order_number: string;
  status: 'paid' | 'voided' | 'draft';
  total: number;
  paid_at: string | null;
  voided_at: string | null;
  customer_id: string | null;
  table_number: string | null;
  refunds: { total: number }[] | null;
}

interface QueryResult<T> {
  data: T | null;
  error: { message: string } | null;
}
interface SelectBuilder {
  eq: (col: string, val: unknown) => SelectBuilder;
  order: (col: string, opts: { ascending: boolean }) => Promise<QueryResult<unknown[]>>;
}
interface LooseFromBuilder {
  select: (cols: string) => SelectBuilder;
}
interface LooseSupabase {
  from: (table: string) => LooseFromBuilder;
}
const sb = supabase as unknown as LooseSupabase;

export function useOrderHistory() {
  const sessionId = useShiftStore((s) => s.current?.id);

  return useQuery<OrderHistoryRow[]>({
    queryKey: ['order-history', sessionId],
    queryFn: async (): Promise<OrderHistoryRow[]> => {
      if (!sessionId) return [];
      const { data, error } = await sb
        .from('orders')
        .select(
          `id, order_number, status, total, paid_at, voided_at, customer_id, table_number,
           refunds(total)`,
        )
        .eq('session_id', sessionId)
        .order('paid_at', { ascending: false });

      if (error) throw new Error(error.message);

      const rows = (data ?? []) as unknown as RawOrderRow[];
      return rows.map((r) => ({
        id: r.id,
        order_number: r.order_number,
        status: r.status,
        total: r.total,
        paid_at: r.paid_at,
        voided_at: r.voided_at,
        customer_id: r.customer_id,
        table_number: r.table_number,
        total_refunded: (r.refunds ?? []).reduce((s, x) => s + Number(x.total), 0),
      }));
    },
    enabled: Boolean(sessionId),
    staleTime: 10_000,
  });
}
