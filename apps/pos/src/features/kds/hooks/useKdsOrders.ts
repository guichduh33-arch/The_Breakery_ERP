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
  /** Spec B-1 Ph2 — multi-station array; NULL for legacy rows not yet re-snapshotted. */
  dispatch_stations: string[] | null;
  sent_to_kitchen_at: string;
  ready_at: string | null;
  /** Session 59 — set by `kds_start_prep_timer_v1`; drives the on-card PrepTimer. */
  prep_started_at: string | null;
  order_number: string;
  /** Session 43 (P2-5) — parent order status; drives the PAID badge on the ticket. */
  order_status: string;
  /** Session 59 (17 D1.1) — order-level free-text note (allergy, "no gluten"...). */
  order_notes: string | null;
  /** Session 10 — true if cashier cancelled the line via cancel_order_item_rpc. */
  is_cancelled: boolean;
  cancelled_at: string | null;
  cancelled_reason: string | null;
  /** S75 (task 7) — resolved via `products → categories.kds_station`. NULL
   *  when the product's category has no station set; the StationFilter chip
   *  predicate treats NULL as "passes every chip" so nothing vanishes
   *  silently for un-configured categories. */
  kds_station: string | null;
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
  /** Spec B-1 Ph2 — multi-station array; NULL for legacy rows. */
  dispatch_stations: string[] | null;
  sent_to_kitchen_at: string;
  ready_at: string | null;
  prep_started_at: string | null;
  is_cancelled: boolean | null;
  cancelled_at: string | null;
  cancelled_reason: string | null;
  // Supabase nested selects can return either a single row or an array
  // depending on the FK cardinality — normalise both shapes below.
  products:
    | { name: string; categories: { kds_station: string | null } | { kds_station: string | null }[] | null }
    | { name: string; categories: { kds_station: string | null } | { kds_station: string | null }[] | null }[]
    | null;
  orders:
    | { order_number: string; status: string; notes: string | null }
    | { order_number: string; status: string; notes: string | null }[]
    | null;
}

function pickFirst<T>(value: T | T[] | null): T | null {
  if (value == null) return null;
  return Array.isArray(value) ? (value[0] ?? null) : value;
}

export function useKdsOrders(station: KdsStation) {
  return useQuery<KdsItemRow[]>({
    queryKey: ['kds', station],
    // P0-2 filet (audit 2026-06-12) : un event realtime perdu (blip Wi-Fi,
    // reconnexion) est rattrapé en ≤ 30 s. Le realtime reste le chemin nominal.
    refetchInterval: 30_000,
    queryFn: async () => {
      const { data, error } = await sb
        .from('order_items')
        .select(
          `
          id, order_id, product_id, quantity, unit_price,
          modifiers, modifiers_total, kitchen_status, dispatch_station,
          dispatch_stations,
          sent_to_kitchen_at, ready_at, prep_started_at,
          is_cancelled, cancelled_at, cancelled_reason,
          products(name, categories(kds_station)),
          orders(order_number, status, notes)
        `,
        )
        // Spec B-1 Ph2 — dual-branch filter:
        //   NEW rows: dispatch_stations array contains the station (cs = contains).
        //   LEGACY rows (dispatch_stations IS NULL): fall back to the single
        //   dispatch_station column so pre-Phase-2 items are not lost.
        .or(
          `dispatch_stations.cs.{${station}},and(dispatch_stations.is.null,dispatch_station.eq.${station})`,
        )
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
          dispatch_stations: row.dispatch_stations ?? null,
          sent_to_kitchen_at: row.sent_to_kitchen_at,
          ready_at: row.ready_at,
          prep_started_at: row.prep_started_at,
          order_number: order?.order_number ?? '?',
          order_status: order?.status ?? '',
          order_notes: order?.notes ?? null,
          is_cancelled: row.is_cancelled === true,
          cancelled_at: row.cancelled_at,
          cancelled_reason: row.cancelled_reason,
          kds_station: pickFirst(product?.categories ?? null)?.kds_station ?? null,
        };
      });
    },
    staleTime: 5_000,
  });
}
