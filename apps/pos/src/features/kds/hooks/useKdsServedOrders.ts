// apps/pos/src/features/kds/hooks/useKdsServedOrders.ts
//
// Session 59 (fiche 04 D1.1 #2) — feeds the "Recently served" recall strip.
// `useKdsOrders` only pulls kitchen_status IN (pending, preparing, ready), so
// a served order drops off the board entirely and there is nowhere left to
// mount `RecallButton`. This hook fills that gap with a narrow read: order
// items marked `served` within the recall window, deduped to one row per
// order (recall acts at the order level via `kds_recall_order_v1`).
//
// The 15-minute window is a client-side display cutoff only — it does not
// limit what `kds_recall_order_v1` itself can recall (the RPC has no time
// bound), it just keeps the strip from growing unbounded over a long shift.

import { useQuery } from '@tanstack/react-query';

import { supabase } from '@/lib/supabase';
import type { KdsStation } from '@/stores/kdsStore';

const RECALL_WINDOW_MS = 15 * 60 * 1_000;

interface QueryResult<T> {
  data: T | null;
  error: { message: string } | null;
}
interface SelectBuilder {
  eq: (col: string, val: unknown) => SelectBuilder;
  gte: (col: string, val: unknown) => SelectBuilder;
  or: (filter: string) => SelectBuilder;
  order: (col: string, opts: { ascending: boolean }) => Promise<QueryResult<unknown[]>>;
}
interface LooseFromBuilder {
  select: (cols: string) => SelectBuilder;
}
interface LooseSupabase {
  from: (table: string) => LooseFromBuilder;
}
const sb = supabase as unknown as LooseSupabase;

export interface KdsServedOrderRow {
  order_id: string;
  order_number: string;
  served_at: string;
}

interface RawRow {
  order_id: string;
  served_at: string | null;
  orders: { order_number: string } | { order_number: string }[] | null;
}

function pickFirst<T>(value: T | T[] | null): T | null {
  if (value == null) return null;
  return Array.isArray(value) ? (value[0] ?? null) : value;
}

export function useKdsServedOrders(station: KdsStation) {
  return useQuery<KdsServedOrderRow[]>({
    queryKey: ['kds-served', station],
    refetchInterval: 30_000,
    queryFn: async () => {
      const sinceIso = new Date(Date.now() - RECALL_WINDOW_MS).toISOString();
      const { data, error } = await sb
        .from('order_items')
        .select('order_id, served_at, orders(order_number)')
        // Same dual-branch station filter as useKdsOrders (Spec B-1 Ph2).
        .or(
          `dispatch_stations.cs.{${station}},and(dispatch_stations.is.null,dispatch_station.eq.${station})`,
        )
        .eq('kitchen_status', 'served')
        .gte('served_at', sinceIso)
        .order('served_at', { ascending: false });

      if (error) throw new Error(error.message);

      const rows = (data ?? []) as unknown as RawRow[];
      // Dedup to one row per order (first row seen = most recently served,
      // since the query is already sorted served_at DESC).
      const byOrder = new Map<string, KdsServedOrderRow>();
      for (const row of rows) {
        if (byOrder.has(row.order_id)) continue;
        const order = pickFirst(row.orders);
        byOrder.set(row.order_id, {
          order_id: row.order_id,
          order_number: order?.order_number ?? '?',
          served_at: row.served_at ?? '',
        });
      }
      return Array.from(byOrder.values());
    },
    staleTime: 5_000,
  });
}
