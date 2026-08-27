// apps/backoffice/src/pages/inventory/StockMovementsPage.tsx
// 2026-06-18 — rewritten to the stock-card ledger layout (running balance per
// product) + CSV export, shared with Reports ▸ Stock Movement History.
//
// Layout:
//   - Page header + CSV export
//   - KPI tile row (movement_type buckets via get_movement_aggregates)
//   - Filter bar (item / type / date range) — ADR-027 : plus de filtre section
//   - StockLedgerTable (full filtered range, server-side running balance + cap)

import { useMemo, useState, type JSX } from 'react';
import { toLocalDateStr } from '@breakery/domain';
// La tuile du BACK-OFFICE, pas celle de `@breakery/ui` : celle-ci rend la valeur
// à 23 px avec `valueTitle`, l'autre à 34 px sans échappatoire. « Value moved »
// posait `formatCurrency` PLEIN — « Rp 148.500.000 », treize caractères mono —
// dans une tuile qui n'en tient pas huit à 1280 px : le montant passait à la
// ligne. Le geste des 46 rapports est le compact + l'exact en infobulle
// (B2BDashboardPage, DailySalesPage). La bande entière suit le même composant :
// deux tuiles de `@breakery/ui` et deux du back-office côte à côte auraient
// donné deux tailles de valeur dans une rangée qui se lit d'un trait. Les
// pastilles d'icône disparaissent avec elles, et c'est un gain — elles étaient
// des aplats que The Ink-Not-Gold Rule interdit ici.
import { KpiTile, KPI_NOTE } from '@/components/kpi/KpiTile.js';
import { formatCount, formatIdr, formatIdrShort, formatQty } from '@/features/dashboard/utils/format.js';
import { useStockLedger } from '@/features/inventory-movements/hooks/useStockLedger.js';
import type { MovementsFilters } from '@/features/inventory-movements/hooks/useStockMovementsFeed.js';
import { useMovementAggregates } from '@/features/inventory-movements/hooks/useMovementAggregates.js';
import { MovementsFiltersBar } from '@/features/inventory-movements/components/MovementsFilters.js';
import { StockLedgerTable } from '@/features/inventory-movements/components/StockLedgerTable.js';
import { enrichLedgerLines, stockLedgerCsvColumns } from '@/features/inventory-movements/stockLedgerColumns.js';
import { ExportButtons } from '@/features/reports/components/ExportButtons.js';
import { PageHeader } from '@/components/PageHeader.js';
import { QueryErrorBanner } from '@/components/QueryErrorBanner.js';
import { errorDetailText } from '@/components/errorDetailText.js';

const IN_TYPES = new Set([
  'purchase', 'incoming', 'transfer_in', 'production_in',
  'opname_in', 'adjustment_in', 'reservation_release',
]);

interface MovementBuckets {
  inCount: number; inQty: number; outCount: number; outQty: number;
  totalCount: number; totalValue: number;
}

function bucketize(rows: readonly { movement_type: string; count: number; qty_total: number; value_total: number | null }[]): MovementBuckets {
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
  });

  const aggs = useMovementAggregates({
    ...(filters.productId ? { productId: filters.productId } : {}),
    dateStart: start,
    dateEnd:   end,
  });

  const result = ledger.data ?? { lines: [], truncated: false, row_count: 0 };
  const rows   = useMemo(() => enrichLedgerLines(result.lines), [result.lines]);
  const buckets = useMemo(() => bucketize(aggs.data ?? []), [aggs.data]);

  return (
    <div className="space-y-6">
      <PageHeader
        className="items-start"
        title="Stock movements"
        subtitle="Per-product stock card over the selected range: opening → in/out → balance, with cost and movement value."
        actions={rows.length > 0 ? (
          <ExportButtons
            csv={{ rows, columns: stockLedgerCsvColumns, filename: `stock-movements-${start}_${end}` }}
          />
        ) : undefined}
      />

      <section className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-4" aria-label="Movement totals">
        <KpiTile label="Movements" value={formatCount(buckets.totalCount)} testId="kpi-movements">
          <span className={KPI_NOTE}>
            {ledger.isLoading ? 'Loading…' : `${formatCount(result.row_count)} in range`}
          </span>
        </KpiTile>
        {/* Le compte d'écritures était posé en `delta` : une VARIATION, alors
            que c'est un dénombrement — la flèche ▲/▼ affirmait une hausse ou une
            baisse qu'aucune période de comparaison ne soutenait. Il redevient la
            note qu'il a toujours été. */}
        <KpiTile label="Stock in" value={formatQty(buckets.inQty)} testId="kpi-stock-in">
          <span className={KPI_NOTE}>{formatCount(buckets.inCount)} entries</span>
        </KpiTile>
        <KpiTile label="Stock out" value={formatQty(buckets.outQty)} testId="kpi-stock-out">
          <span className={KPI_NOTE}>{formatCount(buckets.outCount)} entries</span>
        </KpiTile>
        <KpiTile
          label="Value moved"
          value={formatIdrShort(Math.round(buckets.totalValue))}
          valueTitle={formatIdr(Math.round(buckets.totalValue))}
          testId="kpi-value-moved"
        >
          <span className={KPI_NOTE}>Signed movement value over the range</span>
        </KpiTile>
      </section>

      <MovementsFiltersBar value={filters} onChange={setFilters} />

      {ledger.error !== null ? (
        <QueryErrorBanner
          detail={errorDetailText(ledger.error)}
          onRetry={() => { void ledger.refetch(); }}
          data-testid="stock-movements-error"
        >
          Stock movements could not be loaded — the ledger is withheld rather
          than shown empty.
        </QueryErrorBanner>
      ) : (
        <StockLedgerTable rows={rows} truncated={result.truncated} isLoading={ledger.isLoading} />
      )}
    </div>
  );
}
