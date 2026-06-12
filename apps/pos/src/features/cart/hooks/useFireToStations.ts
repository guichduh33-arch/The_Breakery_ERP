// apps/pos/src/features/cart/hooks/useFireToStations.ts
// Session 34 — real per-station prep-ticket printing.
// Session 43 — P0-3 : persist the order via fire_counter_order_v1 BEFORE
// printing. The DB is the source of truth — a print failure no longer leaves
// items "unsent" (re-firing them would duplicate the DB lines).
import { useRef } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import type { PrepStation, PrinterRole, Product } from '@breakery/domain';
import { groupItemsByStation } from '@breakery/domain';
import type { DispatchStation } from '@breakery/domain';
import type { Json } from '@breakery/supabase';
import { supabase } from '@/lib/supabase';
import { printStationTicket } from '@/services/print/printService';
import type { StationTicketPayload } from '@/services/print/printService';
import { useCartStore } from '@/stores/cartStore';
import { useAuthStore } from '@/stores/authStore';
import { useShiftStore } from '@/stores/shiftStore';
import { useStationPrinters } from './useStationPrinters';
import { useProducts } from '@/features/products/hooks/useProducts';

const PREP_STATIONS: readonly DispatchStation[] = ['barista', 'kitchen', 'bakery'];

/** Build a product_id → dispatch_station map (defaults to 'none'). */
function buildStationMap(
  products: readonly Product[],
): Record<string, DispatchStation> {
  const map: Record<string, DispatchStation> = {};
  for (const p of products) {
    map[p.id] = p.dispatch_station ?? 'none';
  }
  return map;
}

// ---------------------------------------------------------------------------
// Result type
// ---------------------------------------------------------------------------

export interface StationFireResult {
  role: PrepStation;
  ok: boolean;
  error?: string;
  itemIds: string[];
}

// ---------------------------------------------------------------------------
// Optional context passed by the caller (e.g. when order_number is known at
// checkout). The button only knows tableNumber; later tasks pass orderNumber.
// ---------------------------------------------------------------------------

export interface FireContext {
  orderNumber?: string;
  tableNumber?: string;
}

// ---------------------------------------------------------------------------
// Hook
// ---------------------------------------------------------------------------

export interface UseFireToStationsResult {
  mutation: ReturnType<
    typeof useMutation<StationFireResult[], Error, FireContext | undefined>
  >;
  /**
   * Number of currently-unprinted cart items that route to a prep station
   * (dispatch_station ∈ {barista,kitchen,bakery}). Drives the button's
   * `disabled` state — when 0, firing would be a no-op (bread-only orders,
   * products query still loading, everything already printed). Recomputed on
   * every render so the button reacts to cart edits and the products query
   * resolving.
   */
  firableCount: number;
}

export function useFireToStations(): UseFireToStationsResult {
  const queryClient = useQueryClient();
  const { data: printersMap } = useStationPrinters();
  // Subscribe so firableCount recomputes when the products query resolves.
  const { data: products } = useProducts();
  const serverName = useAuthStore((s) => s.user?.full_name ?? 'Staff');
  // Subscribe to the cart so firableCount recomputes on every cart edit.
  const cartItems = useCartStore((s) => s.cart.items);
  const printedItemIds = useCartStore((s) => s.printedItemIds);

  // Derive the firable count from the same data the mutation will use. When
  // `products` is undefined (query loading) the map is empty → count 0 →
  // button disabled, which naturally guards the not-loaded race.
  const stationMap = buildStationMap(products ?? []);
  const firableCount = cartItems.filter((item) => {
    if (item.is_cancelled) return false;
    if (printedItemIds.includes(item.id)) return false;
    const station = stationMap[item.product_id];
    return station != null && (PREP_STATIONS as readonly string[]).includes(station);
  }).length;

  // P0-3 idempotence : the fire's client uuid is generated per FIRE (not per
  // call) and kept across failed attempts — a network retry of the SAME fire
  // replays the same uuid (RPC flavor-2 idempotency). Reset on success.
  const fireClientUuidRef = useRef<string | null>(null);

  const mutation = useMutation<StationFireResult[], Error, FireContext | undefined>({
    mutationFn: async (ctx) => {
      const { orderNumber, tableNumber } = ctx ?? {};

      // 1. Grab unprinted items from the cart store (excludes cancelled lines).
      const unprinted = useCartStore.getState().unprintedItems();
      if (unprinted.length === 0) return [];

      const sessionId = useShiftStore.getState().current?.id;
      if (!sessionId) throw new Error('no_open_shift');

      // 2. P0-3 — persist FIRST via fire_counter_order_v1. ALL unprinted
      //    non-cancelled items go to the RPC, including station-'none' ones:
      //    they must exist on the DB order for payment, even though they
      //    print nowhere.
      fireClientUuidRef.current ??= crypto.randomUUID();
      const existingOrderId = useCartStore.getState().pickedUpOrderId;
      const tableNo =
        tableNumber ?? useCartStore.getState().cart.tableNumber ?? undefined;
      const { data, error } = await supabase.rpc('fire_counter_order_v1', {
        p_client_uuid: fireClientUuidRef.current,
        p_session_id: sessionId,
        p_items: unprinted.map((i) => ({
          product_id: i.product_id,
          quantity: i.quantity,
          unit_price: i.unit_price,
          modifiers: i.modifiers,
          ...(i.discount ? { discount_amount: i.discount.amount } : {}),
        })) as unknown as Json,
        ...(existingOrderId ? { p_order_id: existingOrderId } : {}),
        ...(tableNo !== undefined ? { p_table_number: tableNo } : {}),
        p_order_type: useCartStore.getState().cart.order_type,
      });
      if (error) throw Object.assign(new Error(error.message), { details: error });
      const env = data as unknown as {
        order_id: string;
        order_number: string;
        idempotent_replay: boolean;
      };

      // Success → next fire gets a fresh uuid.
      fireClientUuidRef.current = null;
      if (!existingOrderId) {
        useCartStore.getState().setPickedUpOrderId(env.order_id);
      }

      // 3. The DB is the source of truth: every item we just persisted is
      //    sealed (locked + printed) regardless of print outcome — otherwise a
      //    re-fire would duplicate the lines server-side. Locking first means
      //    there is never a snapshot where a sent item is still editable.
      const allIds = unprinted.map((i) => i.id);
      useCartStore.getState().markLocked(allIds);
      useCartStore.getState().markPrinted(allIds);

      // 4. Build stationByProductId from the live query cache (NOT the render
      //    closure) so routing reflects the products fetched by fire time.
      const cachedProducts =
        queryClient.getQueryData<Product[]>(['products']) ?? [];
      const stationByProductId = buildStationMap(cachedProducts);

      // 5. Group by prep station (cancelled / 'none' / unmapped → excluded
      //    from PRINTING only — they are already persisted above).
      const grouped = groupItemsByStation(unprinted, stationByProductId);

      const entries = Object.entries(grouped) as [PrepStation, typeof unprinted][];
      if (entries.length === 0) return [];

      // 6. Print all station buckets concurrently (best effort — a print
      //    failure does NOT invalidate the persisted order).
      const results = await Promise.all(
        entries.map(async ([station, items]): Promise<StationFireResult> => {
          const itemIds = items.map((i) => i.id);
          const role: PrinterRole = station;

          // Resolve printer for this station.
          const printer = printersMap?.get(role);
          if (!printer) {
            return { role: station, ok: false, error: 'no_printer', itemIds };
          }

          // Build the identifier: caller-supplied order_number if known, else
          // the REAL order number minted by fire_counter_order_v1.
          const orderLabel = orderNumber ?? env.order_number;

          const payload: StationTicketPayload = {
            kind: 'prep',
            role,
            order_number: orderLabel,
            ...(tableNo !== undefined ? { table_number: tableNo } : {}),
            created_at: new Date().toISOString(),
            server_name: serverName,
            items: items.map((item) => ({
              name: item.name,
              quantity: item.quantity,
              modifiers: item.modifiers.map((m) => m.option_label),
            })),
          };

          const { success, error } = await printStationTicket(printer, payload);
          return {
            role: station,
            ok: success,
            ...(error !== undefined ? { error } : {}),
            itemIds,
          };
        }),
      );

      // NOTE (P0-3): items were already locked + marked printed right after
      // the RPC succeeded (step 3) — failed stations are NOT re-firable, the
      // ticket lives in the DB/KDS. Callers surface per-station failures via
      // the returned results ("saved to KDS, not printed").
      return results;
    },
  });

  return { mutation, firableCount };
}
