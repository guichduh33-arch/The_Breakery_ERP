// apps/backoffice/src/pages/reports/StockPositionPage.tsx
//
// « Stock Position at Date » — la photo du stock au soir du jour J. Famille
// Inventory, archétype Report (socle Report shell v2) ; patron : ArAgingPage
// (snapshot). Question tranchée : « quel était mon stock — quantité et
// valeur — le soir du jour J ? » (inventaire comptable, clôture, écarts ;
// maquette + arbitrages validés par Mamat le 2026-08-17 : WAC courant
// étiqueté, vitrine exclue).
//
// TROIS CHOSES QUE CETTE PAGE DIT ET QU'AUCUNE AUTRE NE DISAIT :
//
//  1. LA POSITION À UNE DATE PASSÉE. StockMovementHistory liste les FLUX ;
//     ici c'est le SOLDE reconstruit à J — par l'arrière (current_stock −
//     mouvements postérieurs), donc exact même si le stock initial n'est
//     jamais entré par le ledger.
//  2. LA VALORISATION DIT SON NOM. Chaque valeur est qty × WAC COURANT —
//     l'étiquette vient du serveur (`valuation`) et s'affiche ; l'écart avec
//     le grand livre entre deux opnames est normal (ADR-014), pas un bug.
//  3. LES NÉGATIFS NE SONT PAS MASQUÉS. Une quantité négative (vente à
//     découvert, forçage production) sort en statut 'negative' et se déduit
//     du total — la table recoupe la bande, toujours.

import { useMemo, type JSX } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { cn } from '@breakery/ui';
import type { CsvColumn } from '@breakery/domain';
import { PanelCard } from '@/components/PanelCard.js';
import { KpiTile, KPI_NOTE, KPI_NOTE_HERO } from '@/components/kpi/KpiTile.js';
import { FOCUS_RING } from '@/components/focusRing.js';
import { ReportShell } from '@/features/reports/components/ReportShell.js';
import { KpiBand } from '@/features/reports/components/KpiBand.js';
import { ExportMenu } from '@/features/reports/components/ExportMenu.js';
import { BreakdownCard, type BreakdownRow } from '@/features/reports/components/BreakdownCard.js';
import { ParetoChart } from '@/features/reports/components/charts/ParetoChart.js';
import {
  useStockPosition, type StockPositionProductRow, type StockPositionStatus,
} from '@/features/reports/hooks/useStockPosition.js';
import { buildDrilldownUrl } from '@/features/reports/utils/buildDrilldownUrl.js';
import {
  familyColor, formatIdrCompact, formatIdrFull, formatIdrPrecise,
} from '@/features/reports/utils/chartColors.js';
import { formatCount, shortDate } from '@/features/reports/utils/reportFigures.js';

const csvColumns: CsvColumn<StockPositionProductRow>[] = [
  { header: 'Product',   accessor: (r) => r.name,               format: 'text' },
  { header: 'SKU',       accessor: (r) => r.sku ?? '',          format: 'text' },
  { header: 'Category',  accessor: (r) => r.category_name ?? '', format: 'text' },
  { header: 'Unit',      accessor: (r) => r.unit ?? '',         format: 'text' },
  { header: 'Qty',       accessor: (r) => r.qty,                format: 'number' },
  { header: 'WAC (IDR)', accessor: (r) => r.wac,                format: 'idr' },
  { header: 'Value',     accessor: (r) => r.value,              format: 'idr-round100' },
  { header: 'Threshold', accessor: (r) => r.min_threshold,      format: 'number' },
  { header: 'Status',    accessor: (r) => r.status,             format: 'text' },
];

const NUM_CELL = 'py-2 text-right font-data tabular-nums';
/** Lignes visibles — la feuille d'inventaire complète part au CSV. */
const PRODUCTS_SHOWN = 15;
const PARETO_SHOWN = 10;

function StatusPill({ status }: { status: StockPositionStatus }): JSX.Element {
  switch (status) {
    case 'negative':
      return <span className="text-xs font-semibold text-danger">negative</span>;
    case 'below_threshold':
      return <span className="text-xs font-semibold text-warning">below threshold</span>;
    case 'at_zero':
      return <span className="text-xs text-text-muted">at zero</span>;
    default:
      return <span className="text-xs text-text-muted">ok</span>;
  }
}

export default function StockPositionPage(): JSX.Element {
  const [searchParams, setSearchParams] = useSearchParams();
  const asOf = searchParams.get('as_of') ?? '';
  const today = new Date().toISOString().slice(0, 10);

  const report = useStockPosition(asOf !== '' ? asOf : undefined);
  const summary  = report.data?.summary;
  const products = report.data?.products ?? [];
  const servedAsOf = report.data?.as_of;

  const categoryRows: BreakdownRow[] = useMemo(
    () => (report.data?.by_category ?? []).map((c, i) => ({
      key:    c.category_id ?? 'uncategorized',
      label:  c.category_name ?? 'Uncategorized',
      amount: c.value,
      color:  familyColor('cogs', i),
    })),
    [report.data],
  );

  const paretoRows = useMemo(
    () => products
      .filter((p) => p.value > 0)
      .slice(0, PARETO_SHOWN)
      .map((p) => ({ name: p.name, value: p.value })),
    [products],
  );

  const tiles = [
    {
      key: 'value', label: 'Stock value',
      value: formatIdrCompact(summary?.total_value ?? 0),
      title: formatIdrFull(summary?.total_value ?? 0),
      note:  `as of ${servedAsOf !== undefined && servedAsOf !== '' ? shortDate(servedAsOf) : '—'} · valued at current WAC`,
    },
    {
      key: 'in-stock', label: 'Refs in stock',
      value: formatCount(summary?.refs_in_stock ?? 0),
      note:  `of ${formatCount(summary?.refs_tracked ?? 0)} tracked`,
    },
    {
      key: 'below', label: 'Below threshold',
      value: formatCount(summary?.refs_below_threshold ?? 0),
      note:  'reorder candidates',
    },
    {
      key: 'zero', label: 'At zero',
      value: formatCount(summary?.refs_at_zero ?? 0),
      note:  'nothing left on the shelf',
    },
    {
      key: 'negative', label: 'Negative',
      value: formatCount(summary?.refs_negative ?? 0),
      note:  (summary?.refs_negative ?? 0) > 0
        ? 'oversold or forced — investigate'
        : 'ledger and cache agree',
    },
  ];

  const toolbar = (
    <>
      {/* Un snapshot se choisit par JOUR, pas par période — input date natif
          (le kit n'exporte pas de DatePicker seul), borné à aujourd'hui. */}
      <label className="flex items-center gap-2 text-xs text-text-secondary">
        As of
        <input
          type="date"
          value={asOf !== '' ? asOf : today}
          max={today}
          onChange={(e) => {
            const v = e.target.value;
            setSearchParams((prev) => {
              const next = new URLSearchParams(prev);
              if (v === '' || v === today) next.delete('as_of');
              else next.set('as_of', v);
              return next;
            }, { replace: true });
          }}
          className={cn(
            'rounded-sm border border-border-subtle bg-surface-3 px-2 py-1.5',
            'font-data text-sm text-text-primary', FOCUS_RING,
          )}
          data-testid="as-of-picker"
        />
      </label>
      <ExportMenu
        csv={{ rows: products, columns: csvColumns, filename: `stock-position-${servedAsOf ?? 'today'}` }}
        disabled={products.length === 0}
      />
    </>
  );

  const isEmpty = !report.isLoading && report.data !== undefined
    && (summary?.refs_tracked ?? 0) === 0;

  return (
    <ReportShell
      title="Stock Position at Date"
      subtitle="End-of-day snapshot rebuilt from the movement ledger · valued at current WAC"
      breadcrumb={[{ label: 'Reports', to: '/backoffice/reports' }, { label: 'Inventory' }]}
      toolbar={toolbar}
      error={report.error}
      isEmpty={isEmpty}
      emptyState={{
        title: 'No tracked product',
        description: 'No inventory-tracked product to snapshot at this date.',
      }}
      kpis={
        <KpiBand isLoading={report.isLoading} tiles={tiles.length} labels={tiles.map((t) => t.label)}>
          {tiles.map((t, i) => (
            <KpiTile
              key={t.key}
              label={t.label}
              value={t.value}
              {...(t.title !== undefined ? { valueTitle: t.title } : {})}
              hero={i === 0}
              testId={`kpi-${t.key}`}
            >
              {/* Snapshot : la note porte la date et l'étiquette de
                  valorisation — jamais un Delta inventé. */}
              {t.note !== undefined && (
                <span className={i === 0 ? KPI_NOTE_HERO : KPI_NOTE}>{t.note}</span>
              )}
            </KpiTile>
          ))}
        </KpiBand>
      }
    >
      <p
        className="rounded-sm border border-border-subtle bg-surface-4 px-3 py-2 text-xs text-text-secondary"
        data-testid="scope-caveat"
      >
        <strong>Rebuilt backwards, valued at today's cost.</strong> The position at J is
        current stock minus every movement after J — exact even for products whose
        opening stock never entered the ledger. Values are qty × <em>current</em> WAC
        (historical WAC is a separate project); the gap with the inventory ledger
        between two opnames is expected. Display-case stock is a separate ledger and
        is never added here. Negative quantities are shown, never hidden.
      </p>

      <div className="mt-3 grid gap-3 xl:grid-cols-[1.7fr_1fr]">
        <PanelCard
          title="Where the money sleeps"
          aside={
            <span className="text-xs text-text-muted">
              Top {paretoRows.length} by value · cumulative share of total
            </span>
          }
          isLoading={report.isLoading}
          testId="chart-stock-pareto"
        >
          <ParetoChart
            data={paretoRows}
            xKey="name"
            valueKey="value"
            valueName="Stock value"
            grandTotal={summary?.total_value ?? 0}
            ariaLabel="Stock value per product, sorted descending with cumulative share."
          />
        </PanelCard>
        <BreakdownCard
          title="By category"
          subtitle="Same figures as the band — the sum closes it."
          variant="track"
          rows={categoryRows}
          total={{ label: 'Total stock value', amount: summary?.total_value ?? 0 }}
          isLoading={report.isLoading}
          error={report.error}
          emptyText="Nothing in stock at this date."
          testId="breakdown-categories"
        />
      </div>

      <PanelCard
        title="Inventory sheet"
        aside={
          <span className="text-xs text-text-muted">
            {formatCount(products.length)} refs · by value — the CSV is the full sheet
          </span>
        }
        className="mt-3"
        isLoading={report.isLoading}
        testId="stock-position-table"
      >
        {products.length === 0 ? (
          <p className="py-6 text-center text-sm text-text-muted">
            No tracked product at this date.
          </p>
        ) : (
          <>
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <caption className="sr-only">
                  Stock position per product with quantity, current WAC, value and status
                </caption>
                <thead>
                  <tr className="border-b border-border-subtle text-text-secondary">
                    <th className="py-2 pr-3 text-left font-normal">Product</th>
                    <th className="py-2 pr-3 text-left font-normal">Category</th>
                    <th className="py-2 pr-3 text-right font-normal">Qty</th>
                    <th className="py-2 pr-3 text-left font-normal">Unit</th>
                    <th className="py-2 pr-3 text-right font-normal">WAC</th>
                    <th className="py-2 pr-3 text-right font-normal">Value</th>
                    <th className="py-2 pr-3 text-left font-normal">Status</th>
                  </tr>
                </thead>
                <tbody>
                  {products.slice(0, PRODUCTS_SHOWN).map((p) => {
                    const url = buildDrilldownUrl('product', p.product_id);
                    return (
                      <tr key={p.product_id} className="border-b border-border-subtle">
                        <td className="py-2">
                          {url !== null ? (
                            <Link
                              to={url}
                              className={cn('text-gold underline-offset-2 hover:underline', FOCUS_RING)}
                            >
                              {p.name}
                            </Link>
                          ) : p.name}
                        </td>
                        <td className="py-2 text-text-secondary">{p.category_name ?? '—'}</td>
                        <td className={cn(NUM_CELL, p.qty < 0 && 'font-semibold text-danger')}>
                          {p.qty.toLocaleString('id-ID')}
                        </td>
                        <td className="py-2 text-text-secondary">{p.unit ?? '—'}</td>
                        {/* Coût unitaire : les décimales portent du sens. */}
                        <td className={NUM_CELL}>{formatIdrPrecise(p.wac)}</td>
                        <td className={cn(NUM_CELL, 'font-semibold')}>{formatIdrFull(p.value)}</td>
                        <td className="py-2"><StatusPill status={p.status} /></td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
            {products.length > PRODUCTS_SHOWN && (
              <p className="pt-2 text-xs text-text-muted">
                {PRODUCTS_SHOWN} of {formatCount(products.length)} shown, by value —
                the CSV export is the complete inventory sheet.
              </p>
            )}
          </>
        )}
      </PanelCard>
    </ReportShell>
  );
}
