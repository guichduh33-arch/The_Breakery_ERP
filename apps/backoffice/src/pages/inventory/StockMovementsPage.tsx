// apps/backoffice/src/pages/inventory/StockMovementsPage.tsx
// 2026-06-18 — rewritten to the stock-card ledger layout (running balance per
// product) + CSV export, shared with Reports ▸ Stock Movement History.
//
// Layout:
//   - Page header + CSV export
//   - KPI tile row (movement_type buckets via get_movement_aggregates)
//   - Filter bar (section / type / date range)
//   - StockLedgerTable (full filtered range, server-side running balance + cap)

import { useMemo, useState, type JSX } from 'react';
import { ArrowDownToLine, ArrowUpFromLine, ListTree, Receipt } from 'lucide-react';
import { KpiTile } from '@breakery/ui';
import { toLocalDateStr } from '@breakery/domain';
import { useStockLedger } from '@/features/inventory-movements/hooks/useStockLedger.js';
import type { MovementsFilters } from '@/features/inventory-movements/hooks/useStockMovementsFeed.js';
import { useMovementAggregates } from '@/features/inventory-movements/hooks/useMovementAggregates.js';
import { MovementsFiltersBar } from '@/features/inventory-movements/components/MovementsFilters.js';
import { StockLedgerTable } from '@/features/inventory-movements/components/StockLedgerTable.js';
import { enrichLedgerLines, stockLedgerCsvColumns } from '@/features/inventory-movements/stockLedgerColumns.js';
import { ExportButtons } from '@/features/reports/components/ExportButtons.js';

const IN_TYPES = new Set([
  'purchase', 'incoming', 'transfer_in', 'production_in',
  'opname_in', 'adjustment_in', 'reservation_release',
]);

interface MovementBuckets {
  inCount: number; inQty: number; outCount: number; outQty: number;
  totalCount: number; totalValue: number;
}

function bucketize(rows: ReadonlyArray<{ movement_type: string; count: number; qty_total: number; value_total: number | null }>): MovementBuckets {
  const acc: MovementBuckets = { inCount: 0, inQty: 0, outCount: 0, outQty: 0, totalCount: 0, totalValue: 0 };
  for (const r of rows) {
    const count = Number(r.count) || 0;
    const qty   = Number(r.qty_total) || 0;
    const val   = r.value_total !== null ? Number(r.value_total) : 0;
    acc.totalCount += count;
    acc.totalValue += val;
    if (IN_TYPES.has(r.movement_type)) { acc.inCount += count; acc.inQty += Math.abs(qty); }
    else                               { acc.outCount += count; acc.outQty += Math.abs(qty); }
  }
  return acc;
}

function defaultStart(): string { return toLocalDateStr(new Date(Date.now() - 29 * 86_400_000)); }
function today(): string { return toLocalDateStr(new Date()); }

export default function StockMovementsPage(): JSX.Element {
  const [filters, setFilters] = useState<MovementsFilters>({ dateStart: defaultStart(), dateEnd: today() });

  // Fall back to the default range so the ledger always has bounds (e.g. after Clear).
  const start = filters.dateStart && filters.dateStart !== '' ? filters.dateStart : defaultStart();
  const end   = filters.dateEnd   && filters.dateEnd   !== '' ? filters.dateEnd   : today();

  const ledger = useStockLedger({
    start,
    end,
    ...(filters.productId    ? { productId: filters.productId }       : {}),
    ...(filters.movementType ? { movementType: filters.movementType } : {}),
    ...(filters.sectionId    ? { sectionId: filters.sectionId }       : {}),
  });

  const aggs = useMovementAggregates({
    ...(filters.sectionId ? { sectionId: filters.sectionId } : {}),
    ...(filters.productId ? { productId: filters.productId } : {}),
    dateStart: start,
    dateEnd:   end,
  });

  const result = ledger.data ?? { lines: [], truncated: false, row_count: 0 };
  const rows   = useMemo(() => enrichLedgerLines(result.lines), [result.lines]);
  const buckets = useMemo(() => bucketize(aggs.data ?? []), [aggs.data]);

  return (
    <div className="space-y-6">
      <header className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="font-display text-3xl text-text-primary">Stock movements</h1>
          <p className="mt-1 text-sm text-text-secondary">
            Per-product stock card over the selected range: opening → in/out → balance, with cost and movement value.
          </p>
        </div>
        {rows.length > 0 && (
          <ExportButtons
            csv={{ rows, columns: stockLedgerCsvColumns, filename: `stock-movements-${start}_${end}` }}
          />
        )}
      </header>

      <section className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-4" aria-label="Movement totals">
        <KpiTile
          label="Movements"
          value={buckets.totalCount}
          icon={ListTree}
          footer={ledger.isLoading ? 'Loading…' : `${result.row_count.toLocaleString()} in range`}
        />
        <KpiTile label="Stock in"  value={Number(buckets.inQty.toFixed(2))}  icon={ArrowDownToLine} delta={{ value: buckets.inCount, direction: 'up', hint: 'entries' }} />
        <KpiTile label="Stock out" value={Number(buckets.outQty.toFixed(2))} icon={ArrowUpFromLine} delta={{ value: buckets.outCount, direction: 'down', hint: 'entries' }} />
        <KpiTile label="Value moved" value={Math.round(buckets.totalValue)} valueFormat="currency" icon={Receipt} />
      </section>

      <MovementsFiltersBar value={filters} onChange={setFilters} />

      {ledger.error !== null ? (
        <div role="alert" className="rounded-md border border-danger/40 bg-danger/5 p-3 text-sm text-danger">
          Failed to load movements: {String(ledger.error.message)}
        </div>
      ) : (
        <StockLedgerTable rows={rows} truncated={result.truncated} isLoading={ledger.isLoading} />
      )}
    </div>
  );
}
