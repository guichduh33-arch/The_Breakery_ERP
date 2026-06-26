// apps/pos/src/features/order-history/hooks/useOrderHistory.ts
//
// Session 10 — list paid orders for the current open shift, ordered by paid_at DESC.
// Used by OrderHistoryPanel to surface candidates for void/refund flows.

import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/lib/supabase';
import { useShiftStore } from '@/stores/shiftStore';

/**
 * Finalized order statuses surfaced in the Transaction History panel.
 * Excludes `draft` / `pending_payment` (and any held/in-flight order): those
 * carry total 0 and a null `paid_at`, so they inflated the transaction count,
 * broke the KPI strip, and (NULLS-FIRST) floated to the top of the list.
 * `completed` is the money-path RPC's success status alongside `paid` — both
 * are real sales and MUST be kept (dropping it hid completed orders entirely).
 */
export const FINALIZED_ORDER_STATUSES = ['paid', 'completed', 'voided'] as const;

export interface OrderHistoryRow {
  id: string;
  order_number: string;
  status: 'paid' | 'completed' | 'voided';
  total: number;
  paid_at: string | null;
  voided_at: string | null;
  customer_id: string | null;
  table_number: string | null;
  order_type: string | null;
  /** Sum of refunds.total for this order (audit-only, partials allowed). */
  total_refunded: number;
  /** Primary payment method (first tender method on the order). */
  primary_payment_method: string | null;
  /** Per-method paid totals for the KPI strip. */
  paid_by_method: { method: string; amount: number }[];
}

interface RawOrderRow {
  id: string;
  order_number: string;
  status: 'paid' | 'completed' | 'voided';
  total: number;
  paid_at: string | null;
  voided_at: string | null;
  customer_id: string | null;
  table_number: string | null;
  order_type: string | null;
  refunds: { total: number }[] | null;
  order_payments: { method: string; amount: number }[] | null;
}

interface QueryResult<T> {
  data: T | null;
  error: { message: string } | null;
}
interface SelectBuilder {
  eq: (col: string, val: unknown) => SelectBuilder;
  in: (col: string, vals: readonly unknown[]) => SelectBuilder;
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
          `id, order_number, status, total, paid_at, voided_at, customer_id, table_number, order_type,
           refunds(total),
           order_payments(method, amount)`,
        )
        .eq('session_id', sessionId)
        .in('status', FINALIZED_ORDER_STATUSES)
        .order('paid_at', { ascending: false });

      if (error) throw new Error(error.message);

      const rows = (data ?? []) as unknown as RawOrderRow[];
      return rows.map((r) => {
        const payments = r.order_payments ?? [];
        const byMethod = new Map<string, number>();
        for (const p of payments) {
          byMethod.set(p.method, (byMethod.get(p.method) ?? 0) + Number(p.amount));
        }
        return {
          id: r.id,
          order_number: r.order_number,
          status: r.status,
          total: r.total,
          paid_at: r.paid_at,
          voided_at: r.voided_at,
          customer_id: r.customer_id,
          table_number: r.table_number,
          order_type: r.order_type,
          total_refunded: (r.refunds ?? []).reduce((s, x) => s + Number(x.total), 0),
          primary_payment_method: payments[0]?.method ?? null,
          paid_by_method: Array.from(byMethod.entries()).map(([method, amount]) => ({ method, amount })),
        };
      });
    },
    enabled: Boolean(sessionId),
    staleTime: 10_000,
  });
}
