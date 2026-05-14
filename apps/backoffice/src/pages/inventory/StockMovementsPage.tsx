// apps/backoffice/src/pages/inventory/StockMovementsPage.tsx
// Session 13 / Phase 2.D — stock movements ledger view (Session 12 phase 6).

import { useState, useMemo } from 'react';
import { useStockMovementsFeed, type MovementsFilters } from '@/features/inventory-movements/hooks/useStockMovementsFeed.js';
import { useMovementAggregates } from '@/features/inventory-movements/hooks/useMovementAggregates.js';
import { MovementsFiltersBar } from '@/features/inventory-movements/components/MovementsFilters.js';
import { MovementsTable } from '@/features/inventory-movements/components/MovementsTable.js';

export default function StockMovementsPage() {
  const [filters, setFilters] = useState<MovementsFilters>({});
  const feed = useStockMovementsFeed(filters);
  const aggs = useMovementAggregates({
    ...(filters.sectionId !== undefined && filters.sectionId !== '' ? { sectionId: filters.sectionId } : {}),
    ...(filters.productId !== undefined && filters.productId !== '' ? { productId: filters.productId } : {}),
    ...(filters.dateStart !== undefined && filters.dateStart !== '' ? { dateStart: filters.dateStart } : {}),
    ...(filters.dateEnd   !== undefined && filters.dateEnd   !== '' ? { dateEnd: filters.dateEnd } : {}),
  });

  const flatRows = useMemo(
    () => (feed.data?.pages ?? []).flat(),
    [feed.data?.pages],
  );

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-2xl font-serif text-text-primary">Stock movements</h1>
        <p className="text-sm text-text-secondary">
          The append-only ledger. Every stock change posts here ; cursor pagination
          keeps the round-trip O(1) regardless of total volume.
        </p>
      </div>

      <MovementsFiltersBar value={filters} onChange={setFilters} />

      {(aggs.data ?? []).length > 0 && (
        <div className="flex flex-wrap gap-2">
          {(aggs.data ?? []).map((a) => (
            <div key={a.movement_type} className="border border-border-subtle rounded px-3 py-2 text-xs">
              <div className="font-mono text-text-secondary">{a.movement_type}</div>
              <div className="font-medium">
                {Number(a.count)} · qty {Number(a.qty_total).toFixed(2)}
                {a.value_total !== null && Number(a.value_total) > 0 ? (
                  <span className="text-text-secondary ml-1">· val {Number(a.value_total).toFixed(0)}</span>
                ) : null}
              </div>
            </div>
          ))}
        </div>
      )}

      {feed.isLoading ? (
        <div className="text-sm text-text-secondary">Loading movements…</div>
      ) : feed.error !== null ? (
        <div className="text-sm text-rose-600">Failed to load: {String(feed.error)}</div>
      ) : (
        <MovementsTable
          rows={flatRows}
          hasNext={feed.hasNextPage}
          isFetchingNext={feed.isFetchingNextPage}
          onLoadMore={() => { void feed.fetchNextPage(); }}
        />
      )}
    </div>
  );
}
