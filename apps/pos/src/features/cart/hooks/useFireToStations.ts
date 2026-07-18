// apps/pos/src/features/cart/hooks/useFireToStations.ts
// Session 34 — real per-station prep-ticket printing.
// Session 43 — P0-3 : persist the order via fire_counter_order_v1 BEFORE
// printing. The DB is the source of truth — a print failure no longer leaves
// items "unsent" (re-firing them would duplicate the DB lines).
import { useRef } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import type { PrepStation, PrinterRole } from '@breakery/domain';
import { groupItemsByStation } from '@breakery/domain';
import type { DispatchStation } from '@breakery/domain';
import type { Json } from '@breakery/supabase';
import { supabase } from '@/lib/supabase';
import { printStationTicket } from '@/services/print/printService';
import type { StationTicketPayload } from '@/services/print/printService';
import { useCartStore } from '@/stores/cartStore';
import { useAuthStore } from '@/stores/authStore';
import { useShiftStore } from '@/stores/shiftStore';
import { emitPosEvent } from '@/features/audit/emitPosEvent';
import { getKotCopies } from '@/features/settings/hooks/useKotCopies';
import { useStationPrinters } from './useStationPrinters';
import { useStationMap, getStationMap } from './useStationMap';

const PREP_STATIONS: readonly DispatchStation[] = ['barista', 'kitchen', 'display'];

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
  /**
   * S43 P0-3 — post-payment auto-fire (usePaymentFlowLogic): the order ALREADY
   * exists in the DB — created server-side by complete_order_with_payment_v11
   * (direct pay) or just paid via pay_existing_order_v7 (pickup / fired order).
   * Persisting here would mint an orphan `pending_payment` order (direct pay)
   * or append against a PAID order → P0002 (pickup). When true: skip the RPC
   * and setPickedUpOrderId, just seal (markLocked+markPrinted) and print per
   * station exactly like the legacy flow.
   */
  printOnly?: boolean;
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
   * (dispatch_station ∈ {barista,kitchen,display}). Drives the button's
   * `disabled` state — when 0, firing would be a no-op (bread-only orders,
   * products query still loading, everything already printed). Recomputed on
   * every render so the button reacts to cart edits and the products query
   * resolving.
   */
  firableCount: number;
  /**
   * LOT 3 (KDS, audit 2026-06-25) — number of currently-unprinted cart items
   * whose category routes NOWHERE (dispatch_station 'none' or unmapped). These
   * are persisted on the DB order for payment but never reach a KDS station, so
   * the kitchen never sees them. The button surfaces a non-blocking warning
   * toast when this is > 0 at fire time. Computed off the same live station map
   * as `firableCount` (empty while loading → count 0, no false alarm).
   */
  unroutedCount: number;
}

export function useFireToStations(): UseFireToStationsResult {
  const queryClient = useQueryClient();
  const { data: printersMap } = useStationPrinters();
  // S44 P0-B — subscribe to the station map (includes variant children) so
  // firableCount recomputes when it resolves. NOT useProducts (which filters
  // parent_product_id IS NULL → variant lines route nowhere).
  const { data: stationMapData } = useStationMap();
  const serverName = useAuthStore((s) => s.user?.full_name ?? 'Staff');
  // Subscribe to the cart so firableCount recomputes on every cart edit.
  const cartItems = useCartStore((s) => s.cart.items);
  const printedItemIds = useCartStore((s) => s.printedItemIds);

  // Derive the firable count from the same data the mutation will use. When
  // the station map is undefined (query loading) it is empty → count 0 →
  // button disabled, which naturally guards the not-loaded race.
  const stationMap = stationMapData ?? {};
  // Candidate lines = unprinted, non-cancelled. They split into routed (a prep
  // station) and unrouted ('none'/unmapped). We only flag the unrouted ones
  // once the station map has resolved — an empty map (loading) yields 0 on both
  // counters, so the warning never fires on a stale render.
  const stationMapReady = stationMapData !== undefined && Object.keys(stationMap).length > 0;
  const candidates = cartItems.filter((item) => {
    if (item.is_cancelled) return false;
    if (printedItemIds.includes(item.id)) return false;
    return true;
  });
  const firableCount = candidates.filter((item) => {
    const stations = stationMap[item.product_id] ?? [];
    return stations.some((s) => (PREP_STATIONS as readonly string[]).includes(s));
  }).length;
  const unroutedCount = stationMapReady
    ? candidates.filter((item) => {
        const stations = stationMap[item.product_id] ?? [];
        return !stations.some((s) => (PREP_STATIONS as readonly string[]).includes(s));
      }).length
    : 0;

  // P0-3 idempotence : the fire's client uuid is generated per FIRE (not per
  // call) and kept across failed attempts — a network retry of the SAME fire
  // replays the same uuid (RPC flavor-2 idempotency). Reset on success.
  const fireClientUuidRef = useRef<string | null>(null);

  const mutation = useMutation<StationFireResult[], Error, FireContext | undefined>({
    mutationFn: async (ctx) => {
      const { orderNumber, tableNumber, printOnly = false } = ctx ?? {};

      // Spec A Bloc 4 — this fire is an "additional order" (2nd phase) when the
      // order already exists on the terminal (reopened ⇒ pickedUpOrderId set)
      // and we are not in the post-payment printOnly path.
      const isAdditional = !printOnly && useCartStore.getState().pickedUpOrderId !== null;

      // 1. Grab unprinted items from the cart store (excludes cancelled lines).
      const unprinted = useCartStore.getState().unprintedItems();
      if (unprinted.length === 0) return [];

      const tableNo =
        tableNumber ?? useCartStore.getState().cart.tableNumber ?? undefined;

      // 2. P0-3 — persist FIRST via fire_counter_order_v1. ALL unprinted
      //    non-cancelled items go to the RPC, including station-'none' ones:
      //    they must exist on the DB order for payment, even though they
      //    print nowhere. Skipped in printOnly mode (post-payment auto-fire):
      //    the order is already in the DB — see FireContext.printOnly.
      //
      //    Lines already LOCKED are excluded from the RPC: a line
      //    locked-but-unprinted was persisted by the checkout append
      //    (useCheckout markLocked's it on append success) — re-sending it
      //    would duplicate the DB line. This closes the re-append window
      //    after a checkout append (failed pay → manual fire), and also
      //    converts a manual fire on a pickup cart (all lines locked, none
      //    printed) from a guaranteed P0002 into a working print.
      let persistedOrderNumber: string | undefined;
      if (!printOnly) {
        const lockedIds = useCartStore.getState().lockedItemIds;
        const toPersist = unprinted.filter((i) => !lockedIds.includes(i.id));

        if (toPersist.length > 0) {
          const sessionId = useShiftStore.getState().current?.id;
          if (!sessionId) throw new Error('no_open_shift');

          fireClientUuidRef.current ??= crypto.randomUUID();
          const existingOrderId = useCartStore.getState().pickedUpOrderId;
          // S44 P0-C(3) — fire_counter_order_v4 gates any line discount on an
          // authorizing manager. Hoist the first discounted line's authorizer.
          const fireAuthorizer = toPersist.find((i) => i.discount?.authorized_by)?.discount?.authorized_by;
          const { data, error } = await supabase.rpc('fire_counter_order_v4', {
            p_client_uuid: fireClientUuidRef.current,
            p_session_id: sessionId,
            p_items: toPersist.map((i) => ({
              product_id: i.product_id,
              quantity: i.quantity,
              unit_price: i.unit_price,
              modifiers: i.modifiers,
              // S47 — combo lines persist their components so pay_existing_order_v12
              // deducts each component's stock at payment (the fire only persists).
              ...(i.combo_components ? { combo_components: i.combo_components } : {}),
              ...(i.discount ? { discount_amount: i.discount.amount } : {}),
            })) as unknown as Json,
            ...(existingOrderId ? { p_order_id: existingOrderId } : {}),
            ...(tableNo !== undefined ? { p_table_number: tableNo } : {}),
            p_order_type: useCartStore.getState().cart.order_type,
            ...(fireAuthorizer ? { p_discount_authorized_by: fireAuthorizer } : {}),
          });
          if (error) throw Object.assign(new Error(error.message), { details: error });
          const env = data as unknown as {
            order_id: string;
            order_number: string;
            idempotent_replay: boolean;
          };
          persistedOrderNumber = env.order_number;

          // Success → next fire gets a fresh uuid.
          fireClientUuidRef.current = null;
          if (!existingOrderId) {
            useCartStore.getState().setPickedUpOrderId(env.order_id);
          }
        }
      }

      // 3. The DB is the source of truth: every persisted item (just now, or
      //    already server-side in printOnly mode) is sealed (locked + printed)
      //    regardless of print outcome — otherwise a re-fire would duplicate
      //    the lines server-side. Locking first means there is never a
      //    snapshot where a sent item is still editable.
      const allIds = unprinted.map((i) => i.id);
      useCartStore.getState().markLocked(allIds);
      useCartStore.getState().markPrinted(allIds);

      // S72 audit — the definitive "sent to kitchen" moment: these lines are now
      // sealed (locked + printed) and, unless printOnly, persisted on the DB
      // order. Emitted once per fire; already-printed lines returned early above.
      emitPosEvent('sent_to_kitchen', {
        order_number_snap: orderNumber ?? persistedOrderNumber ?? null,
        payload: { items: allIds.length, print_only: printOnly, additional: isAdditional },
      });

      // 4. Build stationByProductId from the live station-map cache (NOT the
      //    render closure) so routing reflects products fetched by fire time.
      //    S44 P0-B — the station map includes variant children (useProducts
      //    filters them out), so a variant line routes to its real station.
      const stationByProductId = await getStationMap(queryClient);

      // 5. Group by prep station (cancelled / 'none' / unmapped → excluded
      //    from PRINTING only — they are already persisted above).
      const grouped = groupItemsByStation(unprinted, stationByProductId);

      const entries = Object.entries(grouped) as [PrepStation, typeof unprinted][];
      if (entries.length === 0) return [];

      // Chantier KOT copies (_195) — copies papier par station, org-wide
      // (Settings → Printing). Lu du cache live comme la station map ;
      // injoignable → 1 copie par station (comportement historique).
      const kotCopies = await getKotCopies(queryClient);

      // 6. Print all station buckets concurrently (best effort — a print
      //    failure does NOT invalidate the persisted order).
      const results = await Promise.all(
        entries.map(async ([station, items]): Promise<StationFireResult> => {
          const itemIds = items.map((i) => i.id);
          const role: PrinterRole = station;

          // 0 copie = station volontairement sans papier (le KDS écran a déjà
          // reçu via la DB) — skip AVANT la résolution imprimante, pour ne pas
          // remonter un faux 'no_printer' sur une station paperless.
          const copies = kotCopies[station] ?? 1;
          if (copies === 0) {
            return { role: station, ok: true, itemIds };
          }

          // Resolve printer for this station.
          const printer = printersMap?.get(role);
          if (!printer) {
            return { role: station, ok: false, error: 'no_printer', itemIds };
          }

          // Build the identifier: caller-supplied order_number if known, else
          // the REAL order number minted by fire_counter_order_v1 (always
          // caller-supplied in printOnly mode — nothing was persisted here).
          const orderLabel = orderNumber ?? persistedOrderNumber ?? '';

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
            ...(isAdditional ? { additional: true } : {}),
          };

          // N copies séquentielles sur la même imprimante (une imprimante
          // thermique n'aime pas les jobs concurrents) ; on s'arrête à la
          // première erreur — ok = toutes les copies sont sorties.
          let failure: string | undefined;
          for (let copy = 0; copy < copies; copy++) {
            const { success, error } = await printStationTicket(printer, payload);
            if (!success) {
              failure = error ?? 'print_failed';
              break;
            }
          }
          return {
            role: station,
            ok: failure === undefined,
            ...(failure !== undefined ? { error: failure } : {}),
            itemIds,
          };
        }),
      );

      // Spec B-1 Ph1 Bloc 1.4 — un ticket waiter consolidé par fire (best
      // effort, comme les KOT station). Récapitule TOUS les items non annulés
      // (y compris dispatch 'none') pour la distribution table + take-away.
      const waiterPrinter = printersMap?.get('waiter');
      if (waiterPrinter) {
        const waiterItems = unprinted
          .filter((i) => !i.is_cancelled)
          .map((item) => ({
            name: item.name,
            quantity: item.quantity,
            modifiers: item.modifiers.map((m) => m.option_label),
          }));
        if (waiterItems.length > 0) {
          const waiterPayload: StationTicketPayload = {
            kind: 'waiter',
            role: 'waiter',
            order_number: orderNumber ?? persistedOrderNumber ?? '',
            ...(tableNo !== undefined ? { table_number: tableNo } : {}),
            created_at: new Date().toISOString(),
            server_name: serverName,
            items: waiterItems,
            ...(isAdditional ? { additional: true } : {}),
          };
          // Best effort : un échec n'affecte ni la commande ni les results KOT.
          await printStationTicket(waiterPrinter, waiterPayload).catch(() => undefined);
        }
      }

      // NOTE (P0-3): items were already locked + marked printed right after
      // the RPC succeeded (step 3) — failed stations are NOT re-firable, the
      // ticket lives in the DB/KDS. Callers surface per-station failures via
      // the returned results ("saved to KDS, not printed").
      return results;
    },
  });

  return { mutation, firableCount, unroutedCount };
}
