// apps/pos/src/pages/Kds.tsx
//
// Session 2 — Kitchen Display System root page.
// Live queue of items per dispatch station. Subscribes to Supabase Realtime,
// groups items by `order_id` to render one tile per ticket, and applies the
// 5-minute auto-archive of ready items (D9).
//
// Spec ref: docs/superpowers/specs/2026-05-05-session-2-modifiers-kds-spec.md §4.5

import { useMemo } from 'react';

import { useKdsStore } from '@/stores/kdsStore';
import { useKdsOrders, type KdsItemRow } from '@/features/kds/hooks/useKdsOrders';
import { useKdsRealtime } from '@/features/kds/hooks/useKdsRealtime';
import { useAgeTimer } from '@/features/kds/hooks/useAgeTimer';
import { KdsStationSelector } from '@/features/kds/components/KdsStationSelector';
import { KdsOrderCard } from '@/features/kds/components/KdsOrderCard';
import { KdsEmptyState } from '@/features/kds/components/KdsEmptyState';

const ARCHIVE_AFTER_MS = 5 * 60 * 1_000;

function groupByOrder(items: KdsItemRow[]): KdsItemRow[][] {
  const map = new Map<string, KdsItemRow[]>();
  for (const item of items) {
    const bucket = map.get(item.order_id);
    if (bucket) {
      bucket.push(item);
    } else {
      map.set(item.order_id, [item]);
    }
  }
  return Array.from(map.values());
}

export default function KdsPage() {
  const station = useKdsStore((s) => s.selectedStation);
  useKdsRealtime(station);

  const { data: items = [], isLoading } = useKdsOrders(station);
  const now = useAgeTimer(15_000); // re-render every 15s to drop archived tiles

  const visibleOrders = useMemo(() => {
    const visible = items.filter((item) => {
      if (item.kitchen_status !== 'ready') return true;
      if (!item.ready_at) return true;
      const readyAt = new Date(item.ready_at).getTime();
      if (!Number.isFinite(readyAt)) return true;
      return now - readyAt < ARCHIVE_AFTER_MS;
    });
    return groupByOrder(visible);
  }, [items, now]);

  return (
    <div className="h-[100dvh] flex flex-col bg-bg-base text-text-primary">
      <header className="h-16 px-6 flex items-center justify-between border-b border-border-subtle bg-bg-elevated">
        <div className="flex items-center gap-3">
          <h1 className="font-serif text-2xl">Kitchen Display</h1>
          <span className="text-text-secondary text-xs uppercase tracking-widest">
            KDS
          </span>
        </div>
        <KdsStationSelector />
      </header>

      <main id="main-content" tabIndex={-1} className="flex-1 overflow-auto p-6 grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4 auto-rows-min">
        {isLoading ? (
          <div className="col-span-full text-text-secondary text-sm">
            Loading…
          </div>
        ) : visibleOrders.length === 0 ? (
          <KdsEmptyState message="No active tickets" />
        ) : (
          visibleOrders.map((orderItems) => {
            const head = orderItems[0];
            if (!head) return null;
            return (
              <KdsOrderCard key={head.order_id} items={orderItems} />
            );
          })
        )}
      </main>
    </div>
  );
}
