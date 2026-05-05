// apps/pos/src/features/kds/hooks/useKdsOrders.ts
//
// Session 2 — fetch active KDS items for the selected station.
// Returns rows with kitchen_status ∈ {pending, preparing, ready} that have
// been sent to kitchen (is_locked = true). Sorted FIFO by sent_to_kitchen_at.
//
// `ready` items are included so the cashier sees the green "Ready" badge for
// up to 5 minutes; they are filtered out client-side after that window
// (§D9 auto-archive — the DB row stays). Pending/preparing rows stream in
// via the realtime channel (`useKdsRealtime`).
//
// Spec ref: §4.5, §D9.

import { useQuery } from '@tanstack/react-query';
import type { KitchenStatus, DispatchStation } from '@breakery/domain';

import { supabase } from '@/lib/supabase';
import type { KdsStation } from '@/stores/kdsStore';

// The generated `Database` type still reflects the session-1 schema. The
// session-2 migrations add columns (`dispatch_station`, `is_locked`, …) that
// won't appear in the typings until the SQL agent regenerates them. Until
// then, lean on a minimal builder interface that exposes only what we need
// without re-importing @supabase/supabase-js (not a direct dependency).
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

export interface KdsModifierLine {
  group_name: string;
  option_label: string;
  price_adjustment: number;
}

export interface KdsItemRow {
  id: string;
  order_id: string;
  product_id: string;
  product_name: string;
  quantity: number;
  unit_price: number;
  modifiers: KdsModifierLine[];
  modifiers_total: number;
  kitchen_status: KitchenStatus;
  dispatch_station: DispatchStation;
  sent_to_kitchen_at: string;
  ready_at: string | null;
  order_number: string;
}

interface RawRow {
  id: string;
  order_id: string;
  product_id: string;
  quantity: number;
  unit_price: number;
  modifiers: KdsModifierLine[] | null;
  modifiers_total: number | null;
  kitchen_status: KitchenStatus;
  dispatch_station: DispatchStation;
  sent_to_kitchen_at: string;
  ready_at: string | null;
  // Supabase nested selects can return either a single row or an array
  // depending on the FK cardinality — normalise both shapes below.
  products: { name: string } | { name: string }[] | null;
  orders: { order_number: string } | { order_number: string }[] | null;
}

function pickFirst<T>(value: T | T[] | null): T | null {
  if (value == null) return null;
  return Array.isArray(value) ? (value[0] ?? null) : value;
}

export function useKdsOrders(station: KdsStation) {
  return useQuery<KdsItemRow[]>({
    queryKey: ['kds', station],
    queryFn: async () => {
      const { data, error } = await sb
        .from('order_items')
        .select(
          `
          id, order_id, product_id, quantity, unit_price,
          modifiers, modifiers_total, kitchen_status, dispatch_station,
          sent_to_kitchen_at, ready_at,
          products(name),
          orders(order_number)
        `,
        )
        .eq('dispatch_station', station)
        .in('kitchen_status', ['pending', 'preparing', 'ready'])
        .eq('is_locked', true)
        .order('sent_to_kitchen_at', { ascending: true });

      if (error) throw new Error(error.message);

      const rows = (data ?? []) as unknown as RawRow[];
      return rows.map((row) => {
        const product = pickFirst(row.products);
        const order = pickFirst(row.orders);
        return {
          id: row.id,
          order_id: row.order_id,
          product_id: row.product_id,
          product_name: product?.name ?? 'unknown',
          quantity: row.quantity,
          unit_price: row.unit_price,
          modifiers: row.modifiers ?? [],
          modifiers_total: row.modifiers_total ?? 0,
          kitchen_status: row.kitchen_status,
          dispatch_station: row.dispatch_station,
          sent_to_kitchen_at: row.sent_to_kitchen_at,
          ready_at: row.ready_at,
          order_number: order?.order_number ?? '?',
        };
      });
    },
    staleTime: 5_000,
  });
}
