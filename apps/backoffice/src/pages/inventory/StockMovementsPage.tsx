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
import { todayIsoDate } from '@breakery/utils';
import { formatStockQuantity } from '@/features/inventory/stockQuantity.js';
import { Card } from '@/components/BackofficeUi.js';
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
import { KpiTile, KPI_NOTE, KPI_CARD, KPI_LABEL } from '@/components/kpi/KpiTile.js';
import { formatCount, formatIdr, formatIdrShort } from '@/features/dashboard/utils/format.js';
import { useStockLedger } from '@/features/inventory-movements/hooks/useStockLedger.js';
import type { MovementsFilters } from '@/features/inventory-movements/hooks/useStockMovementsFeed.js';
import { useMovementAggregates } from '@/features/inventory-movements/hooks/useMovementAggregates.js';
import type { MovementAggregate } from '@/features/inventory-movements/hooks/useMovementAggregates.js';
import { MovementsFiltersBar } from '@/features/inventory-movements/components/MovementsFilters.js';
import { StockLedgerTable } from '@/features/inventory-movements/components/StockLedgerTable.js';
import { enrichLedgerLines, stockLedgerCsvColumns } from '@/features/inventory-movements/stockLedgerColumns.js';
import { ExportButtons } from '@/features/reports/components/ExportButtons.js';
import { PageHeader } from '@/components/PageHeader.js';
import { QueryErrorBanner } from '@/components/QueryErrorBanner.js';
import { errorDetailText } from '@/components/errorDetailText.js';
import { ChevronRight } from 'lucide-react';

interface MovementBuckets {
  inCount: number; inQty: Map<string, number>; outCount: number; outQty: Map<string, number>;
  totalCount: number; totalValue: number;
}

function bucketize(rows: readonly MovementAggregate[]): MovementBuckets {
  const acc: MovementBuckets = { inCount: 0, inQty: new Map(), outCount: 0, outQty: new Map(), totalCount: 0, totalValue: 0 };
  for (const r of rows) {
    const count = Number(r.count) || 0;
    const qty   = Number(r.qty_total) || 0;
    const val   = r.value_total !== null ? Number(r.value_total) : 0;
    acc.totalCount += count;
    acc.totalValue += val;
    if (r.direction > 0) {
      acc.inCount += count;
      acc.inQty.set(r.unit, (acc.inQty.get(r.unit) ?? 0) + qty);
    } else if (r.direction < 0) {
      acc.outCount += count;
      acc.outQty.set(r.unit, (acc.outQty.get(r.unit) ?? 0) + qty);
    }
  }
  return acc;
}

function defaultStart(): string {
  const date = new Date(`${todayIsoDate()}T00:00:00Z`);
  date.setUTCDate(date.getUTCDate() - 29);
  return date.toISOString().slice(0, 10);
}
function today(): string { return todayIsoDate(); }

function UnitTotals({ label, quantities, count, unavailable, testId }: {
  label: string; quantities: Map<string, number>; count: number; unavailable: boolean; testId: string;
}): JSX.Element {
  return <Card className={KPI_CARD} data-testid={testId}>
    <p className={KPI_LABEL}>{label}</p>
    {unavailable ? <p className="text-text-muted" role="status">Unavailable</p> : (
      <>
        <ul className="grid grid-cols-2 gap-x-3 gap-y-1 font-data text-base tabular-nums text-text-primary">
          {[...quantities].sort(([a], [b]) => a.localeCompare(b)).map(([unit, quantity]) => (
            <li key={unit}>{formatStockQuantity(quantity, unit)}</li>
          ))}
          {quantities.size === 0 && <li>No movements</li>}
        </ul>
        <span className={KPI_NOTE}>{formatCount(count)} entries</span>
      </>
    )}
  </Card>;
}

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
    ...(filters.movementType ? { movementType: filters.movementType } : {}),
    dateStart: start,
    dateEnd:   end,
  });

  const result = ledger.data ?? { lines: [], truncated: false, row_count: 0 };
  const rows   = useMemo(() => enrichLedgerLines(result.lines), [result.lines]);
  const buckets = useMemo(() => bucketize(aggs.data ?? []), [aggs.data]);
  const aggregatesUnavailable = aggs.isLoading || !!aggs.error || aggs.data === undefined;

  return (
    <div className="space-y-6">
      {/* Critique 2026-08-31 — comptabilité et inventaire étaient les seuls
          domaines sans fil d'Ariane. Motif recopié d'OrdersListPage, en ligne :
          en extraire un composant partagé serait une décision d'architecture. */}
      <nav aria-label="Breadcrumb" className="flex items-center gap-1 text-xs text-text-muted">
        <span>Stock</span>
        <ChevronRight className="h-3 w-3 text-text-inert" aria-hidden />
        <span className="text-text-secondary">Live movements</span>
      </nav>

      <PageHeader
        className="items-start"
        title="Stock movements"
        subtitle="Per-product stock card over the selected range: opening → in/out → balance, with cost and movement value."
        actions={!ledger.error && rows.length > 0 ? (
          <ExportButtons
            csv={{ rows, columns: stockLedgerCsvColumns, filename: `stock-movements-${start}_${end}` }}
          />
        ) : undefined}
      />

      <section className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-4" aria-label="Movement totals">
        <KpiTile label="Movements" value={aggregatesUnavailable ? '—' : formatCount(buckets.totalCount)} unavailable={aggregatesUnavailable} testId="kpi-movements">
          <span className={KPI_NOTE}>
            {aggregatesUnavailable ? 'Totals unavailable' : 'Across the selected filters'}
          </span>
        </KpiTile>
        {/* Le compte d'écritures était posé en `delta` : une VARIATION, alors
            que c'est un dénombrement — la flèche ▲/▼ affirmait une hausse ou une
            baisse qu'aucune période de comparaison ne soutenait. Il redevient la
            note qu'il a toujours été. */}
        <UnitTotals label="Stock in" quantities={buckets.inQty} count={buckets.inCount} unavailable={aggregatesUnavailable} testId="kpi-stock-in" />
        <UnitTotals label="Stock out" quantities={buckets.outQty} count={buckets.outCount} unavailable={aggregatesUnavailable} testId="kpi-stock-out" />
        <KpiTile
          label="Value moved"
          value={aggregatesUnavailable ? '—' : formatIdrShort(Math.round(buckets.totalValue))}
          {...(!aggregatesUnavailable ? { valueTitle: formatIdr(Math.round(buckets.totalValue)) } : {})}
          unavailable={aggregatesUnavailable}
          testId="kpi-value-moved"
        >
          <span className={KPI_NOTE}>Signed movement value over the range</span>
        </KpiTile>
      </section>

      <MovementsFiltersBar value={filters} onChange={setFilters} />
      {aggs.error && <QueryErrorBanner onRetry={() => { void aggs.refetch(); }}>Movement totals could not be loaded.</QueryErrorBanner>}

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
