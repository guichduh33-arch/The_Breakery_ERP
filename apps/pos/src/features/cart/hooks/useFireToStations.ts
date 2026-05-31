// apps/pos/src/features/cart/hooks/useFireToStations.ts
// Session 34 — real per-station prep-ticket printing.
// Replaces the fake useSendToKitchen hook that only called markLocked().
import { useMutation } from '@tanstack/react-query';
import type { PrepStation, PrinterRole } from '@breakery/domain';
import { groupItemsByStation } from '@breakery/domain';
import type { DispatchStation } from '@breakery/domain';
import { printStationTicket } from '@/services/print/printService';
import type { StationTicketPayload } from '@/services/print/printService';
import { useCartStore } from '@/stores/cartStore';
import { useAuthStore } from '@/stores/authStore';
import { useStationPrinters } from './useStationPrinters';
import { useProducts } from '@/features/products/hooks/useProducts';

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

export function useFireToStations() {
  const { data: printersMap } = useStationPrinters();
  const { data: products } = useProducts();
  const serverName = useAuthStore((s) => s.user?.full_name ?? 'Staff');

  return useMutation<StationFireResult[], Error, FireContext | undefined>({
    mutationFn: async (ctx) => {
      const { orderNumber, tableNumber } = ctx ?? {};

      // 1. Grab unprinted items from the cart store.
      const unprinted = useCartStore.getState().unprintedItems();
      if (unprinted.length === 0) return [];

      // 2. Build stationByProductId from the cached products query.
      const stationByProductId: Record<string, DispatchStation> = {};
      for (const p of products ?? []) {
        stationByProductId[p.id] = p.dispatch_station ?? 'none';
      }

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

      // 5. Mark printed + locked only for stations that succeeded.
      const successfulIds = results
        .filter((r) => r.ok)
        .flatMap((r) => r.itemIds);

      if (successfulIds.length > 0) {
        useCartStore.getState().markPrinted(successfulIds);
        useCartStore.getState().markLocked(successfulIds);
      }

      return results;
    },
  });
}
