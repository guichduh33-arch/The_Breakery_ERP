// apps/backoffice/src/pages/inventory/StockMovementsPage.tsx
// Session 14 / Phase 4.C — stock movements ledger view, rewritten against the
// `stock mouvement.jpg` screenshot family.
//
// Layout:
//   - Page header (Fraunces title + supporting copy)
//   - KPI tile row aggregating each movement_type bucket (in / out / value)
//   - Filter bar (section / type / date range / clear)
//   - DataTable (qty colorisée, sticky-ish chrome via primitive)
//
// Stays in scope of Phase 4.C — touches only this page + adjacent
// `inventory-movements` feature components (filters/table reused).

import { useMemo, useState, type JSX } from 'react';
import {
  ArrowDownToLine,
  ArrowUpFromLine,
  ListTree,
  Receipt,
} from 'lucide-react';
import {
  DataTable,
  KpiTile,
  type DataTableColumn,
} from '@breakery/ui';
import {
  useStockMovementsFeed,
  type MovementsFilters,
  type MovementRow,
} from '@/features/inventory-movements/hooks/useStockMovementsFeed.js';
import { useMovementAggregates } from '@/features/inventory-movements/hooks/useMovementAggregates.js';
import { MovementsFiltersBar } from '@/features/inventory-movements/components/MovementsFilters.js';

// Movements coded with the `_in / +qty` semantics. Anything else is treated as
// out / negative-effect.
const IN_TYPES = new Set([
  'purchase',
  'incoming',
  'transfer_in',
  'production_in',
  'opname_in',
  'adjustment_in',
  'reservation_release',
]);

interface MovementBuckets {
  inCount:    number;
  inQty:      number;
  outCount:   number;
  outQty:     number;
  totalCount: number;
  totalValue: number;
}

function bucketize(rows: ReadonlyArray<{ movement_type: string; count: number; qty_total: number; value_total: number | null }>): MovementBuckets {
  const acc: MovementBuckets = {
    inCount: 0, inQty: 0, outCount: 0, outQty: 0, totalCount: 0, totalValue: 0,
  };
  for (const r of rows) {
    const count = Number(r.count) || 0;
    const qty   = Number(r.qty_total) || 0;
    const val   = r.value_total !== null ? Number(r.value_total) : 0;
    acc.totalCount += count;
    acc.totalValue += val;
    if (IN_TYPES.has(r.movement_type)) {
      acc.inCount  += count;
      acc.inQty    += Math.abs(qty);
    } else {
      acc.outCount += count;
      acc.outQty   += Math.abs(qty);
    }
  }
  return acc;
}

const COLUMNS: ReadonlyArray<DataTableColumn<MovementRow>> = [
  {
    id: 'when',
    header: 'When',
    width: '180px',
    render: (r) => (
      <span className="font-mono text-xs text-text-secondary whitespace-nowrap">
        {new Date(r.created_at).toLocaleString()}
      </span>
    ),
  },
  {
    id: 'type',
    header: 'Type',
    width: '140px',
    render: (r) => (
      <span className="inline-flex items-center rounded-md border border-border-subtle bg-bg-base px-2 py-0.5 font-mono text-[11px] uppercase tracking-wide text-text-secondary">
        {r.movement_type.replace(/_/g, ' ')}
      </span>
    ),
  },
  {
    id: 'product',
    header: 'Product',
    render: (r) => (
      <div className="space-y-0.5">
        <div className="font-medium text-text-primary">{r.product_name ?? '—'}</div>
        <div className="font-mono text-[11px] text-text-muted">{r.product_sku ?? ''}</div>
      </div>
    ),
  },
  {
    id: 'qty',
    header: 'Qty',
    align: 'right',
    width: '110px',
    render: (r) => {
      const positive = r.quantity > 0;
      return (
        <span className={`font-mono ${positive ? 'text-success' : 'text-danger'}`}>
          {positive ? '+' : ''}{r.quantity} <span className="text-text-muted">{r.unit}</span>
        </span>
      );
    },
  },
  {
    id: 'route',
    header: 'From → To',
    width: '140px',
    render: (r) => (
      <span className="font-mono text-xs text-text-secondary">
        {r.from_section_code ?? '—'} <span className="text-text-muted">→</span> {r.to_section_code ?? '—'}
      </span>
    ),
  },
  {
    id: 'reason',
    header: 'Reason',
    render: (r) => (
      <span className="text-xs text-text-secondary line-clamp-1">{r.reason ?? ''}</span>
    ),
  },
  {
    id: 'by',
    header: 'By',
    width: '140px',
    render: (r) => (
      <span className="text-xs text-text-secondary">{r.author_name ?? ''}</span>
    ),
  },
];

export default function StockMovementsPage(): JSX.Element {
  const [filters, setFilters] = useState<MovementsFilters>({});
  const feed = useStockMovementsFeed(filters);
  const aggs = useMovementAggregates({
    ...(filters.sectionId !== undefined && filters.sectionId !== '' ? { sectionId: filters.sectionId } : {}),
    ...(filters.productId !== undefined && filters.productId !== '' ? { productId: filters.productId } : {}),
    ...(filters.dateStart !== undefined && filters.dateStart !== '' ? { dateStart: filters.dateStart } : {}),
    ...(filters.dateEnd   !== undefined && filters.dateEnd   !== '' ? { dateEnd: filters.dateEnd } : {}),
  });

  const flatRows = useMemo<MovementRow[]>(
    () => (feed.data?.pages ?? []).flat(),
    [feed.data?.pages],
  );

  const buckets = useMemo(() => bucketize(aggs.data ?? []), [aggs.data]);

  return (
    <div className="space-y-6">
      <header>
        <h1 className="font-display text-3xl text-text-primary">Stock movements</h1>
        <p className="mt-1 text-sm text-text-secondary">
          The append-only ledger. Every stock change posts here ; cursor pagination
          keeps the round-trip O(1) regardless of total volume.
        </p>
      </header>

      <section
        className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-4"
        aria-label="Movement totals"
      >
        <KpiTile
          label="Movements"
          value={buckets.totalCount}
          icon={ListTree}
          footer={feed.isLoading ? 'Loading…' : `${flatRows.length.toLocaleString()} loaded`}
        />
        <KpiTile
          label="Stock in"
          value={Number(buckets.inQty.toFixed(2))}
          icon={ArrowDownToLine}
          delta={{ value: buckets.inCount, direction: 'up', hint: 'entries' }}
        />
        <KpiTile
          label="Stock out"
          value={Number(buckets.outQty.toFixed(2))}
          icon={ArrowUpFromLine}
          delta={{ value: buckets.outCount, direction: 'down', hint: 'entries' }}
        />
        <KpiTile
          label="Value moved"
          value={Math.round(buckets.totalValue)}
          valueFormat="currency"
          icon={Receipt}
        />
      </section>

      <MovementsFiltersBar value={filters} onChange={setFilters} />

      {feed.error !== null ? (
        <div role="alert" className="rounded-md border border-danger/40 bg-danger/5 p-3 text-sm text-danger">
          Failed to load movements: {String(feed.error)}
        </div>
      ) : (
        <DataTable
          data-testid="movements-table"
          columns={COLUMNS}
          rows={flatRows}
          getRowKey={(r) => r.id}
          isLoading={feed.isLoading}
          emptyTitle="No movements yet"
          emptyDescription="As soon as stock is received, sold, transferred, or counted, the entries land here."
        />
      )}

      {feed.hasNextPage && (
        <div className="flex justify-center">
          <button
            type="button"
            onClick={() => { void feed.fetchNextPage(); }}
            disabled={feed.isFetchingNextPage}
            className="inline-flex h-9 items-center gap-2 rounded-md border border-border-subtle bg-bg-elevated px-4 text-sm text-text-primary transition-colors duration-fast hover:bg-bg-overlay disabled:opacity-50"
          >
            {feed.isFetchingNextPage ? 'Loading…' : 'Load more'}
          </button>
        </div>
      )}
    </div>
  );
}
