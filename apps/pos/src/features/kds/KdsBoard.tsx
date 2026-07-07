// apps/pos/src/features/kds/KdsBoard.tsx
//
// Session 14 / Phase 3.A — Kitchen Display System board (full-screen view).
//
// Refs (docs/Design/backoffice):
//   - `live order.jpg`     — Topbar with "Live Orders" title + station tabs +
//     filter chips. Grid below with order cards.
//   - `live order2.jpg`    — Order detail / drilldown: same chrome, ticket
//     cards stay rectangular with a border that picks up urgency colour.
//   - `kds configue.jpg`   — Source of truth for the warning/urgent thresholds
//     applied on the cards (300s / 600s).
//
// Session 59 (04 D1.1 / D1.3) — mounts the recall strip (`useKdsServedOrders`
// + `RecentlyServedStrip`, the only place `RecallButton` is reachable, since
// served items drop out of the main `useKdsOrders` query) and the new-order
// WebAudio alarm (`useKdsAlarm`) with its persisted mute toggle in the header.
//
// The board is split out from `pages/Kds.tsx` so it can be reused under
// other shells later (e.g. embedded inside a Customer Display dual-pane view)
// without owning the realtime subscription itself. The page-level wrapper
// continues to call `useKdsRealtime(station)` because that hook MUST mount
// once per station (see CLAUDE.md note about StrictMode-sensitive channel
// names — DO NOT call it inside KdsBoard).
//
// Constraints:
//   - Zero hardcoded colours. Every surface flows from design tokens via
//     Tailwind preset (`bg-bg-base`, `text-text-primary`, `border-border-subtle`,
//     `text-gold`, …).
//   - Layout: header (title + station picker + filter chips) above a CSS grid
//     that wraps responsively (1 col mobile → 4 cols xl). Empty state lives
//     in `KdsEmptyState`. Loading is a single muted line — KDS users care
//     about throughput, not skeleton sophistication.
//   - File <500 lines (currently ~140). Logic kept tight: groupByOrder + the
//     5-minute auto-archive of `ready` items. Grouping is FIFO-stable
//     (Map insertion order = first-seen).

import { useMemo } from 'react';
import { Loader2, Volume2, VolumeX, WifiOff } from 'lucide-react';

import { SectionLabel } from '@breakery/ui';

import { ErrorState } from '@/components/ErrorState';
import { useKdsStore, type KdsStation, type KdsStationFilter } from '@/stores/kdsStore';
import { useKdsOrders, type KdsItemRow } from './hooks/useKdsOrders';
import { useKdsServedOrders } from './hooks/useKdsServedOrders';
import { useAgeTimer } from './hooks/useAgeTimer';
import { useKdsAlarm } from './hooks/useKdsAlarm';
import { KdsStationSelector } from './components/KdsStationSelector';
import { KdsOrderCard } from './components/KdsOrderCard';
import { KdsEmptyState } from './components/KdsEmptyState';
import { StationFilter } from './components/StationFilter';
import { RecentlyServedStrip } from './components/RecentlyServedStrip';

/** Ready items are kept on screen for 5 minutes so the cashier sees the
 *  green badge before they disappear (D9 — auto-archive client-side). */
const ARCHIVE_AFTER_MS = 5 * 60 * 1_000;

/** Realtime tick is cheap (no network, just `setNow`). 15s is enough to
 *  drop archived tiles without thrashing React. The cards have their own
 *  1s tick via `useAgeTimer()` for MM:SS smoothness. */
const ARCHIVE_TICK_MS = 15_000;

interface KdsBoardProps {
  /** Optional station override — defaults to the persisted store value.
   *  Useful for embeds that want to pin the board to a specific station. */
  station?: KdsStation;
  /** Design Wave C — realtime channel health. When `false`, a "Reconnecting…"
   *  banner warns the kitchen that new tickets may be delayed. The page wrapper
   *  wires this from `useKdsRealtime({ onConnectionChange })`. Defaults to
   *  `true` so embeds that don't own the subscription never flash the warning. */
  isRealtimeConnected?: boolean;
}

function groupByOrder(items: KdsItemRow[]): KdsItemRow[][] {
  // Map preserves insertion order, so the first item's sent_to_kitchen_at
  // (FIFO from the SQL query) determines the order of cards in the grid.
  const map = new Map<string, KdsItemRow[]>();
  for (const item of items) {
    const bucket = map.get(item.order_id);
    if (bucket) bucket.push(item);
    else map.set(item.order_id, [item]);
  }
  return Array.from(map.values());
}

export function KdsBoard({
  station: stationProp,
  isRealtimeConnected = true,
}: KdsBoardProps = {}) {
  const storeStation = useKdsStore((s) => s.selectedStation);
  const stationFilter = useKdsStore((s) => s.kdsStationFilter);
  const alarmMuted = useKdsStore((s) => s.alarmMuted);
  const setAlarmMuted = useKdsStore((s) => s.setAlarmMuted);
  const station = stationProp ?? storeStation;

  const { data: items = [], isLoading, isError, refetch } = useKdsOrders(station);
  const { data: servedOrders = [] } = useKdsServedOrders(station);
  const now = useAgeTimer(ARCHIVE_TICK_MS);

  // Session 59 (04 D1.3) — one beep per newly-arrived order, deduped by
  // order_id and gated on the persisted mute toggle below.
  useKdsAlarm(items);

  const visibleOrders = useMemo(() => {
    const visible = items.filter((item) => filterAndArchive(item, stationFilter, now));
    return groupByOrder(visible);
  }, [items, stationFilter, now]);

  return (
    <div className="h-[100dvh] flex flex-col bg-bg-base text-text-primary">
      <header className="px-6 py-4 flex flex-col gap-3 border-b border-border-subtle bg-bg-elevated">
        <div className="flex items-center justify-between gap-4">
          <div className="flex items-baseline gap-3">
            <h1 className="font-display text-2xl text-text-primary">
              Live Orders
            </h1>
            <SectionLabel as="span" size="sm" className="text-gold">
              KDS
            </SectionLabel>
          </div>
          <div className="flex items-center gap-3">
            <button
              type="button"
              onClick={() => setAlarmMuted(!alarmMuted)}
              aria-label={alarmMuted ? 'Unmute new-order alarm' : 'Mute new-order alarm'}
              aria-pressed={alarmMuted}
              className="rounded-md border border-border-subtle p-2 text-text-secondary hover:text-text-primary"
            >
              {alarmMuted ? (
                <VolumeX className="h-5 w-5" aria-hidden />
              ) : (
                <Volume2 className="h-5 w-5" aria-hidden />
              )}
            </button>
            <KdsStationSelector />
          </div>
        </div>
        <StationFilter />
      </header>

      {/* Design Wave C — realtime reconnection banner. Kept out of the header so
          it can't shift the station picker; full-width, warning-toned, always
          legible from across the kitchen. */}
      {!isRealtimeConnected && (
        <div
          role="status"
          aria-live="polite"
          data-testid="kds-reconnecting-banner"
          className="flex items-center justify-center gap-3 bg-warning-soft px-6 py-3 text-warning border-b border-amber-warn/40"
        >
          <WifiOff className="h-6 w-6 animate-pulse" aria-hidden />
          <span className="text-lg font-bold uppercase tracking-widest">
            Reconnexion en cours…
          </span>
          <span className="hidden md:inline text-base font-medium normal-case tracking-normal opacity-90">
            Les nouveaux tickets peuvent être retardés.
          </span>
        </div>
      )}

      <RecentlyServedStrip orders={servedOrders} />

      <main
        id="main-content"
        tabIndex={-1}
        className="flex-1 overflow-auto p-6 grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4 auto-rows-min"
      >
        {isError ? (
          // Never fall through to "No active tickets" on a fetch error — the
          // kitchen would wrongly believe the queue is empty (C-D1).
          <div className="col-span-full">
            <ErrorState
              title="Connexion au KDS perdue"
              description="Les tickets n'ont pas pu être chargés. Vérifiez le réseau et réessayez."
              onRetry={() => void refetch()}
            />
          </div>
        ) : isLoading ? (
          <div
            className="col-span-full h-full grid place-items-center text-text-secondary"
            data-testid="kds-loading"
          >
            <div className="text-center space-y-4">
              <Loader2 className="h-16 w-16 mx-auto animate-spin text-gold" aria-hidden />
              <p className="text-2xl font-semibold tracking-wide">
                Chargement des tickets…
              </p>
            </div>
          </div>
        ) : visibleOrders.length === 0 ? (
          <KdsEmptyState message="No active tickets" />
        ) : (
          visibleOrders.map((orderItems) => {
            const head = orderItems[0];
            if (!head) return null;
            return <KdsOrderCard key={head.order_id} items={orderItems} />;
          })
        )}
      </main>
    </div>
  );
}

/** Combine the station-filter chip narrow with the 5-minute ready archive.
 *  Pulled out for testability — the predicate is tiny but covered by tests. */
function filterAndArchive(
  item: KdsItemRow,
  stationFilter: KdsStationFilter,
  now: number,
): boolean {
  // 1) Drop ready items that have been ready for > ARCHIVE_AFTER_MS (D9).
  if (item.kitchen_status === 'ready' && item.ready_at) {
    const readyAt = new Date(item.ready_at).getTime();
    if (Number.isFinite(readyAt) && now - readyAt >= ARCHIVE_AFTER_MS) {
      return false;
    }
  }

  // 2) Apply the granular station-filter chip ('all' is a passthrough).
  //    The server query already narrows by `dispatch_station`. The chip
  //    further narrows on `categories.kds_station` if that column ever
  //    surfaces on KdsItemRow. Until then we only enforce 'all' (and let
  //    the future field hook in here without a refactor).
  if (stationFilter !== 'all') {
    const chip = (item as KdsItemRow & { kds_station?: string }).kds_station;
    if (chip && chip !== stationFilter) return false;
  }

  return true;
}

export default KdsBoard;
