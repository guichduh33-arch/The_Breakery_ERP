// apps/pos/src/features/display/hooks/useReadyOrders.ts
//
// Session 59 (16 D1.2) — customer-display "Ready for pickup" ticker source.
//
// `useDisplayOrders` only surfaces orders whose `status` is paid/completed —
// it says nothing about whether the kitchen has actually finished the food.
// This hook queries `order_items` directly for rows sitting in
// `kitchen_status = 'ready'` (bumped at the KDS, not yet served) and
// aggregates them by `order_id` so a single ticker row represents "this
// order has at least one item ready to hand over", surfaced with **no**
// payment precondition (dine-in bar tabs, tablet orders not yet settled,
// counter orders fired before tender, etc.).
//
// Realtime refresh is wired in `useDisplayRealtime` (shared channel,
// `order_items` postgres_changes → invalidates READY_ORDERS_QUERY_KEY).
// `refetchInterval` here is the same 30s catch-up net as `useKdsOrders`.

import { useQuery } from '@tanstack/react-query';

import { supabase } from '@/lib/supabase';

import { READY_ORDERS_QUERY_KEY } from './useDisplayRealtime';

export interface ReadyOrder {
  order_id: string;
  order_number: string;
  order_type: string;
  table_number: string | null;
  ready_at: string | null;
}

interface RawReadyRow {
  order_id: string;
  ready_at: string | null;
  orders:
    | { order_number: string; order_type: string; table_number: string | null }
    | { order_number: string; order_type: string; table_number: string | null }[]
    | null;
}

function pickFirst<T>(value: T | T[] | null): T | null {
  if (value == null) return null;
  return Array.isArray(value) ? (value[0] ?? null) : value;
}

export function useReadyOrders(enabled: boolean = true) {
  return useQuery<ReadyOrder[]>({
    queryKey: READY_ORDERS_QUERY_KEY,
    enabled,
    queryFn: async () => {
      const { data, error } = await supabase
        .from('order_items')
        .select('order_id, ready_at, orders(order_number, order_type, table_number)')
        .eq('kitchen_status', 'ready')
        .eq('is_cancelled', false)
        .order('ready_at', { ascending: true });
      if (error) throw error;

      const rows = (data ?? []) as unknown as RawReadyRow[];

      // Aggregate item rows by order_id — a single ticker row per order,
      // keyed on the earliest `ready_at` amongst its ready items.
      const byOrder = new Map<string, ReadyOrder>();
      for (const row of rows) {
        const order = pickFirst(row.orders);
        const existing = byOrder.get(row.order_id);
        if (existing !== undefined) continue; // already recorded (earliest wins, rows are ascending).
        byOrder.set(row.order_id, {
          order_id: row.order_id,
          order_number: order?.order_number ?? '?',
          order_type: order?.order_type ?? '',
          table_number: order?.table_number ?? null,
          ready_at: row.ready_at,
        });
      }

      return Array.from(byOrder.values());
    },
    refetchInterval: 30_000,
    staleTime: 5_000,
    refetchOnWindowFocus: false,
  });
}
