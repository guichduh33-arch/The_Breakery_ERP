// apps/pos/src/features/cart/hooks/useFireToStations.ts
// Session 34 — real per-station prep-ticket printing.
// Replaces the fake useSendToKitchen hook that only called markLocked().
import { useMutation, useQueryClient } from '@tanstack/react-query';
import type { PrepStation, PrinterRole, Product } from '@breakery/domain';
import { groupItemsByStation } from '@breakery/domain';
import type { DispatchStation } from '@breakery/domain';
import { printStationTicket } from '@/services/print/printService';
import type { StationTicketPayload } from '@/services/print/printService';
import { useCartStore } from '@/stores/cartStore';
import { useAuthStore } from '@/stores/authStore';
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

  const mutation = useMutation<StationFireResult[], Error, FireContext | undefined>({
    mutationFn: async (ctx) => {
      const { orderNumber, tableNumber } = ctx ?? {};

      // 1. Grab unprinted items from the cart store.
      const unprinted = useCartStore.getState().unprintedItems();
      if (unprinted.length === 0) return [];

      // 2. Build stationByProductId from the live query cache (NOT the render
      //    closure) so routing reflects the products fetched by fire time.
      const cachedProducts =
        queryClient.getQueryData<Product[]>(['products']) ?? [];
      const stationByProductId = buildStationMap(cachedProducts);

      // 3. Group by prep station (cancelled / 'none' / unmapped → excluded).
      const grouped = groupItemsByStation(unprinted, stationByProductId);

      const entries = Object.entries(grouped) as [PrepStation, typeof unprinted][];
      if (entries.length === 0) return [];

      // 4. Fire all station buckets concurrently.
      const results = await Promise.all(
        entries.map(async ([station, items]): Promise<StationFireResult> => {
          const itemIds = items.map((i) => i.id);
          const role: PrinterRole = station;

          // Resolve printer for this station.
          const printer = printersMap?.get(role);
          if (!printer) {
            return { role: station, ok: false, error: 'no_printer', itemIds };
          }

          // Build the identifier: use order_number if known, else table / walk-in label.
          const orderLabel =
            orderNumber ??
            (tableNumber ? `Table ${tableNumber}` : 'Walk-in');

          const payload: StationTicketPayload = {
            kind: 'prep',
            role,
            order_number: orderLabel,
            ...(tableNumber !== undefined ? { table_number: tableNumber } : {}),
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

      // 5. Lock THEN mark printed for stations that succeeded. Locking first
      //    means there is never an intermediate snapshot where a printed item
      //    is still editable (canEdit true). Failed stations are left
      //    untouched so they can be re-fired.
      const successfulIds = results
        .filter((r) => r.ok)
        .flatMap((r) => r.itemIds);

      if (successfulIds.length > 0) {
        useCartStore.getState().markLocked(successfulIds);
        useCartStore.getState().markPrinted(successfulIds);
      }

      return results;
    },
  });

  return { mutation, firableCount };
}
