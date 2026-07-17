// apps/pos/src/features/products/hooks/useServiceSpeed.ts
//
// Session 13 / Phase 4.A — feed for the ServiceSpeedIndicator badge.
//
// Computes a coarse "kitchen rhythm" signal for the current local hour:
//   - average fulfillment time = avg(paid_at - created_at) for paid orders
//     completed in the current hour (local timezone)
//   - order count this hour (already exposed by get_sales_by_hour_v3)
//
// The indicator does NOT promise SLA accuracy ; it's a glance signal that
// helps a cashier-manager decide whether to call extra hands. Therefore we
// accept the cheaper query path:
//   - read order_count from get_sales_by_hour_v3
//   - read avg(paid_at - created_at) via a lightweight inline query against
//     `orders` for today, this hour. RLS already constrains visibility.

import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/lib/supabase';

export interface ServiceSpeedSnapshot {
  /** Local hour (0-23) the snapshot was taken in. */
  hour: number;
  /** Orders paid this hour. 0 → indicator shows "idle". */
  orderCount: number;
  /** Average fulfillment time in seconds. Null when no orders yet. */
  avgFulfillmentSeconds: number | null;
}

interface SalesByHourRow {
  hour: number;
  total: number;
  order_count: number;
}

interface FulfillmentRow {
  created_at: string;
  paid_at: string | null;
}

interface QueryResult<T> {
  data: T | null;
  error: { message: string } | null;
}
interface SelectBuilder {
  eq: (col: string, val: unknown) => SelectBuilder;
  in: (col: string, vals: readonly unknown[]) => SelectBuilder;
  gte: (col: string, val: unknown) => SelectBuilder;
  not: (col: string, op: string, val: unknown) => SelectBuilder;
  then: <R>(fn: (qr: QueryResult<FulfillmentRow[]>) => R) => Promise<R>;
}
interface LooseFromBuilder {
  select: (cols: string) => SelectBuilder;
}
interface LooseSupabase {
  rpc: (fn: string, args: Record<string, unknown>) => Promise<{ data: SalesByHourRow[] | null; error: { message: string } | null }>;
  from: (table: string) => LooseFromBuilder;
}

/**
 * Local-date stamp YYYY-MM-DD in the device timezone — passed to
 * `get_sales_by_hour_v3` which internally normalises to business_config.timezone.
 */
function todayLocalISO(): string {
  const d = new Date();
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

/**
 * @param enabled - Pass false from the caller (e.g. the indicator) when the
 *                  current user lacks `reports.read` ; the query stays cold
 *                  and no network roundtrip is made.
 */
export function useServiceSpeed(enabled: boolean = true) {
  return useQuery<ServiceSpeedSnapshot>({
    queryKey: ['service-speed', todayLocalISO(), new Date().getHours()],
    queryFn: async (): Promise<ServiceSpeedSnapshot> => {
      const sb = supabase as unknown as LooseSupabase;
      const now = new Date();
      const hour = now.getHours();

      // ── Pull hourly counts via the existing reports RPC (Phase 2.B). ──────
      // ADR-009 déc. 4 : repointé v1 (droppée depuis S50) → v3 (paid|completed).
      const { data: rows, error: rpcErr } = await sb.rpc('get_sales_by_hour_v3', {
        p_date: todayLocalISO(),
      });
      if (rpcErr) throw new Error(rpcErr.message);
      const thisHour = (rows ?? []).find((r) => r.hour === hour);
      const orderCount = thisHour?.order_count ?? 0;

      if (orderCount === 0) {
        return { hour, orderCount: 0, avgFulfillmentSeconds: null };
      }

      // ── Compute avg fulfillment by scanning today's paid orders. ──────────
      // The volume is small (a single hour worth of orders) ; client-side
      // avg is acceptable. Filter on `paid_at` not null, today's local
      // boundary as a coarse `gte` (the indicator re-keys every hour so the
      // filter doesn't need to be exact-hour-bounded).
      const hourStart = new Date(now.getFullYear(), now.getMonth(), now.getDate(), hour);
      const builder = sb
        .from('orders')
        .select('created_at, paid_at')
        .in('status', ['paid', 'completed'])
        .gte('paid_at', hourStart.toISOString())
        .not('paid_at', 'is', null);
      const result = await (builder as unknown as Promise<QueryResult<FulfillmentRow[]>>);
      if (result.error) throw new Error(result.error.message);

      const deltas = (result.data ?? [])
        .map((r) => {
          if (!r.paid_at || !r.created_at) return null;
          const created = new Date(r.created_at).getTime();
          const paid = new Date(r.paid_at).getTime();
          if (Number.isNaN(created) || Number.isNaN(paid) || paid < created) return null;
          return (paid - created) / 1000;
        })
        .filter((x): x is number => x !== null);

      const avg = deltas.length > 0
        ? deltas.reduce((s, n) => s + n, 0) / deltas.length
        : null;

      return {
        hour,
        orderCount,
        avgFulfillmentSeconds: avg,
      };
    },
    enabled,
    // Refresh once a minute — a glance signal doesn't need realtime.
    refetchInterval: 60_000,
    staleTime: 30_000,
  });
}
