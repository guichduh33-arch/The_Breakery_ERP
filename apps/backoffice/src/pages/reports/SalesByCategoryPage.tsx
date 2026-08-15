// apps/backoffice/src/pages/reports/SalesByCategoryPage.tsx
//
// Lot D (campagne Reports 2026-08-15) — vague Sales, page 2/6. Migrée sur le
// socle Report shell v2 (archétype maquette 4c, patron : DailySalesPage).
//
//  1. LE REMPLISSAGE OR EST PARTI (`fill="var(--gold-base)"`). L'or est une
//     encre de sens, jamais une série : le graphe passe par `PairedBarsChart`
//     et sa série normée.
//  2. La comparaison survit à la migration : elle était portée par
//     `DateRangePickerWithCompare` + une bande de deltas maison ; elle est
//     désormais sur CHAQUE tuile de la bande KPI, et en seconde série du graphe
//     quand le bouton « Compare » est actif. L'appariement se fait par
//     CATÉGORIE (`category_id`), jamais par rang : un classement qui bouge
//     comparerait deux catégories différentes.
//  3. La carte de ventilation totalise le jeu COMPLET et referme ses 100 % par
//     un reliquat « Others » — cinq lignes montrées ne font pas un total.

import { useMemo, type JSX } from 'react';
import { Link } from 'react-router-dom';
import type { CsvColumn } from '@breakery/domain';
import { PanelCard } from '@/components/PanelCard.js';
import { KpiTile, KPI_NOTE, KPI_NOTE_HERO } from '@/components/kpi/KpiTile.js';
import { Delta } from '@/components/kpi/Delta.js';
import { ReportShell } from '@/features/reports/components/ReportShell.js';
import { KpiBand } from '@/features/reports/components/KpiBand.js';
import { PeriodControl } from '@/features/reports/components/PeriodControl.js';
import { ExportMenu } from '@/features/reports/components/ExportMenu.js';
import {
  BreakdownCard, type BreakdownRow, type ShareSegment,
} from '@/features/reports/components/BreakdownCard.js';
import { PairedBarsChart } from '@/features/reports/components/charts/PairedBarsChart.js';
import { useReportPeriod } from '@/features/reports/hooks/useReportPeriod.js';
import {
  useSalesByCategory, type SalesCategoryRow,
} from '@/features/reports/hooks/useSalesByCategory.js';
import { buildDrilldownUrl } from '@/features/reports/utils/buildDrilldownUrl.js';
import {
  CHART_1, TEXT_INERT, categoricalColor, formatIdrCompact, formatIdrFull,
} from '@/features/reports/utils/chartColors.js';
import {
  formatCount, formatPct1, pctChange, periodLabel, sharePct, topSlice,
} from '@/features/reports/utils/reportFigures.js';

const csvColumns: CsvColumn<SalesCategoryRow>[] = [
  { header: 'Category', accessor: (r) => r.category_name, format: 'text' },
  { header: 'Revenue',  accessor: (r) => r.total,         format: 'idr-round100' },
  { header: 'Qty',      accessor: (r) => r.qty,           format: 'number' },
];

const NUM_CELL = 'py-2 text-right font-data tabular-nums';
const INK_LINK = 'text-gold underline-offset-2 hover:underline focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-gold';
/** Barres lisibles : au-delà, l'axe devient une frise illisible — la table dit
 *  le reste, et l'aside annonce la coupe. */
const MAX_BARS = 8;
const MAX_TICK_CHARS = 14;

interface KpiDescriptor {
  key: string; label: string; value: string;
  title?: string; delta?: number | null; note?: string;
}

function sumRows(rows: SalesCategoryRow[]): { total: number; qty: number } {
  return rows.reduce(
    (acc, r) => ({ total: acc.total + r.total, qty: acc.qty + r.qty }),
    { total: 0, qty: 0 },
  );
}

function truncate(s: string): string {
  return s.length > MAX_TICK_CHARS ? `${s.slice(0, MAX_TICK_CHARS - 1)}…` : s;
}

export default function SalesByCategoryPage(): JSX.Element {
  // Les bornes portaient DÉJÀ les noms standards `start` / `end` : aucun repli
  // de nom n'est nécessaire ici (le drapeau `compare` devient `cmp`).
  const period = useReportPeriod();
  const { start, end, compareRange } = period;

  const current = useSalesByCategory(start, end);
  const compare = useSalesByCategory(compareRange.start, compareRange.end);

  const rows    = useMemo(() => current.data ?? [], [current.data]);
  const cmpRows = useMemo(() => compare.data ?? [], [compare.data]);

  const sorted = useMemo(
    () => rows.slice().sort((a, b) => b.total - a.total),
    [rows],
  );
  const sums     = useMemo(() => sumRows(rows), [rows]);
  const prevSums = useMemo(() => sumRows(cmpRows), [cmpRows]);

  const comparable = compare.data !== undefined ? prevSums : undefined;
  const hasCompare = period.compare && compare.data !== undefined;

  // Appariement par identité, jamais par rang.
  const chartData = useMemo(() => {
    const cmpMap = new Map(cmpRows.map((r) => [r.category_id, r.total]));
    return sorted.slice(0, MAX_BARS).map((r) => ({
      category: r.category_name,
      current:  r.total,
      compare:  cmpMap.get(r.category_id) ?? 0,
    }));
  }, [sorted, cmpRows]);

  const top = topSlice(sorted, (r) => r.total);
  const topRows: BreakdownRow[] = top.rows.map((r, i) => {
    const url = buildDrilldownUrl('category', r.category_id, { date_from: start, date_to: end });
    return {
      key:      r.category_id,
      label:    r.category_name,
      amount:   r.total,
      sharePct: sharePct(r.total, top.total),
      color:    categoricalColor(i),
      ...(url !== null ? { to: url } : {}),
    };
  });

  // Sans le reliquat, cinq segments sur une base entière laisseraient un vide
  // qui se lit comme une part manquante.
  const shownShare = topRows.reduce((s, r) => s + (r.sharePct ?? 0), 0);
  const segments: ShareSegment[] = [
    ...topRows.map((r) => ({ label: r.label, pct: r.sharePct ?? 0, color: r.color ?? CHART_1 })),
    ...(shownShare < 99.95 ? [{ label: 'Others', pct: 100 - shownShare, color: TEXT_INERT }] : []),
  ];

  const avgItem     = sums.qty > 0 ? sums.total / sums.qty : 0;
  const prevAvgItem = comparable !== undefined && comparable.qty > 0
    ? comparable.total / comparable.qty
    : undefined;
  const leader = sorted[0];

  const tiles: KpiDescriptor[] = [
    {
      key: 'revenue', label: 'Revenue',
      value: formatIdrCompact(sums.total), title: formatIdrFull(sums.total),
      delta: pctChange(sums.total, comparable?.total),
    },
    {
      key: 'items-sold', label: 'Items sold', value: formatCount(sums.qty),
      delta: pctChange(sums.qty, comparable?.qty),
    },
    {
      key: 'avg-item', label: 'Avg item price',
      value: formatIdrCompact(avgItem), title: formatIdrFull(avgItem),
      delta: pctChange(avgItem, prevAvgItem),
    },
    {
      key: 'categories', label: 'Categories', value: formatCount(rows.length),
      delta: pctChange(rows.length, comparable !== undefined ? cmpRows.length : undefined),
    },
    {
      // Une variation n'a pas de sens sur un NOM : la tuile porte la part.
      key: 'top-category', label: 'Top category',
      value: leader?.category_name ?? '—',
      note:  leader !== undefined
        ? `${formatPct1(sharePct(leader.total, sums.total))} of revenue`
        : 'no sale in this period',
    },
  ];

  const meta = [
    periodLabel(start, end),
    `${formatCount(rows.length)} categor${rows.length === 1 ? 'y' : 'ies'}`,
    'revenue and quantity per product category',
  ].join(' · ');

  const toolbar = (
    <>
      <PeriodControl period={period} showCompare />
      <ExportMenu
        csv={{ rows, columns: csvColumns, filename: `sales-by-category-${start}_${end}` }}
        pdf={{
          template: 'sales_by_category',
          data:     rows,
          period:   { start, end },
          filename: `sales-by-category-${start}_${end}`,
          ...(hasCompare ? { comparePrevious: { data: cmpRows } } : {}),
        }}
        disabled={rows.length === 0}
      />
    </>
  );

  return (
    <ReportShell
      title="Sales by Category"
      subtitle={meta}
      breadcrumb={[{ label: 'Reports', to: '/backoffice/reports' }, { label: 'Sales' }]}
      toolbar={toolbar}
      error={current.error}
      isEmpty={!current.isLoading && current.data !== undefined && rows.length === 0}
      emptyState={{ title: 'No sales', description: 'No sales in the selected date range.' }}
      kpis={
        <KpiBand isLoading={current.isLoading} tiles={tiles.length} labels={tiles.map((t) => t.label)}>
          {tiles.map((t, i) => (
            <KpiTile
              key={t.key}
              label={t.label}
              value={t.value}
              {...(t.title !== undefined ? { valueTitle: t.title } : {})}
              hero={i === 0}
              testId={`kpi-${t.key}`}
            >
              {t.delta !== undefined && <Delta value={t.delta} period="prev" onInk={i === 0} />}
              {t.note !== undefined && (
                <span className={i === 0 ? KPI_NOTE_HERO : KPI_NOTE}>{t.note}</span>
              )}
            </KpiTile>
          ))}
        </KpiBand>
      }
    >
      <div className="grid gap-3 xl:grid-cols-[1.7fr_1fr]">
        <PanelCard
          title="Revenue by category"
          aside={sorted.length > MAX_BARS ? (
            <span className="text-xs text-text-muted">
              Top {MAX_BARS} of {formatCount(sorted.length)}
            </span>
          ) : undefined}
          isLoading={current.isLoading}
          testId="chart-revenue-by-category"
        >
          <PairedBarsChart
            data={chartData}
            xKey="category"
            currentKey="current"
            currentName="This period"
            {...(hasCompare ? { compareKey: 'compare', compareName: 'Previous period' } : {})}
            xTickFormatter={(v) => truncate(String(v))}
            xTickAngle={-25}
            ariaLabel={`Revenue per product category from ${start} to ${end}${hasCompare ? ', compared with the previous period' : ''}.`}
          />
        </PanelCard>
        <BreakdownCard
          title="Category share"
          subtitle={top.note}
          variant="track"
          rows={topRows}
          total={{ label: 'Total', amount: top.total }}
          isLoading={current.isLoading}
          error={current.error}
          shareBar={{
            title:     'Share of revenue',
            ariaLabel: 'Share of revenue by category',
            segments,
          }}
          shareBarPlacement="after-total"
          testId="breakdown-categories"
        />
      </div>

      <PanelCard
        title="Category detail"
        className="mt-3"
        isLoading={current.isLoading}
        testId="sbc-category-detail"
      >
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <caption className="sr-only">Revenue and quantity per product category</caption>
            <thead>
              <tr className="border-b border-border-subtle text-text-secondary">
                <th scope="col" className="py-2 text-left">Category</th>
                <th scope="col" className="py-2 text-right">Total</th>
                <th scope="col" className="py-2 text-right">Share</th>
                <th scope="col" className="py-2 text-right">Qty</th>
              </tr>
            </thead>
            <tbody>
              {sorted.map((r) => {
                const url = buildDrilldownUrl('category', r.category_id, {
                  date_from: start, date_to: end,
                });
                return (
                  <tr key={r.category_id} className="border-b border-border-subtle">
                    <td className="py-2">
                      {url !== null
                        ? <Link to={url} className={INK_LINK}>{r.category_name}</Link>
                        : r.category_name}
                    </td>
                    <td className={NUM_CELL}>{formatIdrFull(r.total)}</td>
                    <td className={NUM_CELL}>{formatPct1(sharePct(r.total, sums.total))}</td>
                    <td className={NUM_CELL}>{formatCount(r.qty)}</td>
                  </tr>
                );
              })}
            </tbody>
            {sorted.length > 0 && (
              <tfoot>
                <tr className="border-t border-border-subtle font-semibold">
                  <td className="py-2">Total</td>
                  <td className={NUM_CELL}>{formatIdrFull(sums.total)}</td>
                  <td className={NUM_CELL}>100,0%</td>
                  <td className={NUM_CELL}>{formatCount(sums.qty)}</td>
                </tr>
              </tfoot>
            )}
          </table>
        </div>
      </PanelCard>
    </ReportShell>
  );
}
