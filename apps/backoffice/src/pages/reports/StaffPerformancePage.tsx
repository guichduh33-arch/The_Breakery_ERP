// apps/backoffice/src/pages/reports/StaffPerformancePage.tsx
//
// Lot D (campagne Reports 2026-08-15) — vague Sales, page 5/6. Migrée sur le
// socle Report shell v2 (archétype maquette 4c, patron : DailySalesPage).
//
// La page rendait une table de douze colonnes sans figure ni comparaison, alors
// que la RPC porte `orders_served`, `voids_count`, `refunds_*` et `discount_*`.
// Ce qui change :
//
//  · la comparaison contre la période précédente, ajoutée (le hook accepte
//    n'importe quelle fenêtre) — sur chaque tuile, et en seconde série du
//    graphe, appariée par `staff_id` et jamais par rang ;
//  · une bande KPI où les tuiles de CONTRÔLE (voids, remboursements, remises)
//    sont marquées `invert` : y monter est une mauvaise nouvelle, la couleur
//    suit le sens métier et non le signe ;
//  · un graphe unique — les commandes servies, l'axe que la table ne montre
//    pas en forme. Les valeurs monétaires restent chiffrées.
//
// Statu quo arbitré : la table conserve ses colonnes de contrôle telles quelles
// (elles viennent de la RPC), et la page n'attribue rien qu'elle ne reçoive.

import { useMemo, type JSX } from 'react';
import { Link } from 'react-router-dom';
import type { CsvColumn } from '@breakery/domain';
import { formatNumber } from '@breakery/utils';
import { PanelCard } from '@/components/PanelCard.js';
import { KpiTile, KPI_NOTE, KPI_NOTE_HERO } from '@/components/kpi/KpiTile.js';
import { Delta } from '@/components/kpi/Delta.js';
import { ReportShell } from '@/features/reports/components/ReportShell.js';
import { KpiBand } from '@/features/reports/components/KpiBand.js';
import { PeriodControl } from '@/features/reports/components/PeriodControl.js';
import { ExportMenu } from '@/features/reports/components/ExportMenu.js';
import { BreakdownCard, type BreakdownRow } from '@/features/reports/components/BreakdownCard.js';
import { PairedBarsChart } from '@/features/reports/components/charts/PairedBarsChart.js';
import { useReportPeriod } from '@/features/reports/hooks/useReportPeriod.js';
import {
  useStaffPerformance, type StaffPerformanceRow,
} from '@/features/reports/hooks/useStaffPerformance.js';
import { buildDrilldownUrl } from '@/features/reports/utils/buildDrilldownUrl.js';
import {
  categoricalColor, formatIdrCompact, formatIdrFull,
} from '@/features/reports/utils/chartColors.js';
import {
  formatCount, pctChange, periodLabel, sharePct, topSlice,
} from '@/features/reports/utils/reportFigures.js';

const csvColumns: CsvColumn<StaffPerformanceRow>[] = [
  { header: 'Staff',                 accessor: (r) => r.staff_name,            format: 'text' },
  { header: 'Orders',               accessor: (r) => r.orders_served,         format: 'number' },
  { header: 'Revenue (IDR)',        accessor: (r) => r.revenue,               format: 'idr-round100' },
  { header: 'AOV (IDR)',            accessor: (r) => r.aov,                   format: 'idr-round100' },
  { header: 'Items per Order',      accessor: (r) => r.items_per_order,       format: 'number' },
  { header: 'Voids Count',         accessor: (r) => r.voids_count,           format: 'number' },
  { header: 'Voids Value (IDR)',   accessor: (r) => r.voids_value,           format: 'idr-round100' },
  { header: 'Refunds Count',       accessor: (r) => r.refunds_count,         format: 'number' },
  { header: 'Refunds Value (IDR)', accessor: (r) => r.refunds_value,         format: 'idr-round100' },
  { header: 'Discount Orders',     accessor: (r) => r.discount_orders_count, format: 'number' },
  { header: 'Discount Value (IDR)', accessor: (r) => r.discount_value,       format: 'idr-round100' },
  { header: 'Items Cancelled',     accessor: (r) => r.items_cancelled,       format: 'number' },
];

const NUM_CELL = 'py-2 text-right font-data tabular-nums';
const INK_LINK = 'text-gold underline-offset-2 hover:underline focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-gold';
const MAX_BARS = 8;
const MAX_TICK_CHARS = 14;

interface KpiDescriptor {
  key: string; label: string; value: string;
  title?: string; delta: number | null; invert?: boolean; note?: string;
}

interface StaffTotals {
  revenue: number; orders: number;
  voidsValue: number; voidsCount: number;
  refundsValue: number; refundsCount: number;
  discountValue: number; discountOrders: number;
}

function sumRows(rows: StaffPerformanceRow[]): StaffTotals {
  return rows.reduce<StaffTotals>((acc, r) => ({
    revenue:        acc.revenue + r.revenue,
    orders:         acc.orders + r.orders_served,
    voidsValue:     acc.voidsValue + r.voids_value,
    voidsCount:     acc.voidsCount + r.voids_count,
    refundsValue:   acc.refundsValue + r.refunds_value,
    refundsCount:   acc.refundsCount + r.refunds_count,
    discountValue:  acc.discountValue + r.discount_value,
    discountOrders: acc.discountOrders + r.discount_orders_count,
  }), {
    revenue: 0, orders: 0, voidsValue: 0, voidsCount: 0,
    refundsValue: 0, refundsCount: 0, discountValue: 0, discountOrders: 0,
  });
}

function truncate(s: string): string {
  return s.length > MAX_TICK_CHARS ? `${s.slice(0, MAX_TICK_CHARS - 1)}…` : s;
}

export default function StaffPerformancePage(): JSX.Element {
  // Bornes déjà nommées `start` / `end` : aucun repli de nom nécessaire.
  const period = useReportPeriod();
  const { start, end, compareRange } = period;

  const current = useStaffPerformance({ start, end });
  const compare = useStaffPerformance({ start: compareRange.start, end: compareRange.end });

  const rows    = useMemo(() => current.data?.by_staff ?? [], [current.data?.by_staff]);
  const cmpRows = useMemo(() => compare.data?.by_staff ?? [], [compare.data?.by_staff]);

  const sorted   = useMemo(() => rows.slice().sort((a, b) => b.revenue - a.revenue), [rows]);
  const sums     = useMemo(() => sumRows(rows), [rows]);
  const prevSums = useMemo(() => sumRows(cmpRows), [cmpRows]);

  const comparable = compare.data !== undefined ? prevSums : undefined;
  const hasCompare = period.compare && compare.data !== undefined;

  const chartData = useMemo(() => {
    const cmpMap = new Map(cmpRows.map((r) => [r.staff_id, r.orders_served]));
    return sorted.slice(0, MAX_BARS).map((r) => ({
      staff:   r.staff_name,
      current: r.orders_served,
      compare: cmpMap.get(r.staff_id) ?? 0,
    }));
  }, [sorted, cmpRows]);

  const revenueTop = topSlice(sorted, (r) => r.revenue);
  const revenueRows: BreakdownRow[] = revenueTop.rows.map((r, i) => {
    const url = buildDrilldownUrl('order_list', '', { served_by: r.staff_id, start, end });
    return {
      key:      r.staff_id,
      label:    r.staff_name,
      amount:   r.revenue,
      sharePct: sharePct(r.revenue, revenueTop.total),
      color:    categoricalColor(i),
      ...(url !== null ? { to: url } : {}),
    };
  });

  const discountTop = topSlice(
    rows.filter((r) => r.discount_value > 0).sort((a, b) => b.discount_value - a.discount_value),
    (r) => r.discount_value,
    'discount value',
  );
  const discountRows: BreakdownRow[] = discountTop.rows.map((r) => ({
    key:    r.staff_id,
    label:  r.staff_name,
    amount: r.discount_value,
    count:  `${formatCount(r.discount_orders_count)} orders`,
  }));

  const aov     = sums.orders > 0 ? sums.revenue / sums.orders : 0;
  const prevAov = comparable !== undefined && comparable.orders > 0
    ? comparable.revenue / comparable.orders
    : undefined;

  const tiles: KpiDescriptor[] = [
    {
      key: 'revenue', label: 'Revenue',
      value: formatIdrCompact(sums.revenue), title: formatIdrFull(sums.revenue),
      delta: pctChange(sums.revenue, comparable?.revenue),
    },
    {
      key: 'orders', label: 'Orders served', value: formatCount(sums.orders),
      delta: pctChange(sums.orders, comparable?.orders),
      note:  `${formatCount(rows.length)} staff`,
    },
    {
      key: 'aov', label: 'Avg order value',
      value: formatIdrCompact(aov), title: formatIdrFull(aov),
      delta: pctChange(aov, prevAov),
    },
    {
      key: 'voids', label: 'Voids',
      value: formatIdrCompact(sums.voidsValue), title: formatIdrFull(sums.voidsValue),
      delta: pctChange(sums.voidsValue, comparable?.voidsValue), invert: true,
      note:  `${formatCount(sums.voidsCount)} voids`,
    },
    {
      key: 'refunds', label: 'Refunds',
      value: formatIdrCompact(sums.refundsValue), title: formatIdrFull(sums.refundsValue),
      delta: pctChange(sums.refundsValue, comparable?.refundsValue), invert: true,
      note:  `${formatCount(sums.refundsCount)} refunds`,
    },
    {
      key: 'discounts', label: 'Discounts',
      value: formatIdrCompact(sums.discountValue), title: formatIdrFull(sums.discountValue),
      delta: pctChange(sums.discountValue, comparable?.discountValue), invert: true,
      note:  `${formatCount(sums.discountOrders)} tickets`,
    },
  ];

  const meta = [
    periodLabel(start, end),
    `${formatCount(rows.length)} staff member${rows.length === 1 ? '' : 's'}`,
    'orders, revenue and control figures per staff',
  ].join(' · ');

  const toolbar = (
    <>
      <PeriodControl period={period} showCompare />
      {/* Pas de PDF : aucun gabarit `staff_performance` dans l'EF generate-pdf. */}
      <ExportMenu
        csv={{ rows, columns: csvColumns, filename: `staff-performance-${start}_${end}` }}
        disabled={rows.length === 0}
      />
    </>
  );

  return (
    <ReportShell
      title="Staff Performance"
      subtitle={meta}
      breadcrumb={[{ label: 'Reports', to: '/backoffice/reports' }, { label: 'Operations' }]}
      toolbar={toolbar}
      error={current.error}
      isEmpty={!current.isLoading && current.data !== undefined && rows.length === 0}
      emptyState={{
        title: 'No performance data',
        description: 'No staff performance data for this period.',
      }}
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
              <Delta value={t.delta} period="prev" invert={t.invert === true} onInk={i === 0} />
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
          title="Orders served by staff"
          aside={sorted.length > MAX_BARS ? (
            <span className="text-xs text-text-muted">
              Top {MAX_BARS} of {formatCount(sorted.length)}
            </span>
          ) : undefined}
          isLoading={current.isLoading}
          testId="chart-orders-by-staff"
        >
          <PairedBarsChart
            data={chartData}
            xKey="staff"
            currentKey="current"
            currentName="This period"
            {...(hasCompare ? { compareKey: 'compare', compareName: 'Previous period' } : {})}
            xTickFormatter={(v) => truncate(String(v))}
            xTickAngle={-25}
            yTickFormatter={formatCount}
            valueFormatter={(v) => `${formatCount(v)} orders`}
            ariaLabel={`Orders served per staff member from ${start} to ${end}${hasCompare ? ', compared with the previous period' : ''}.`}
          />
        </PanelCard>
        <div className="grid gap-3">
          <BreakdownCard
            title="Revenue share"
            subtitle={revenueTop.note}
            variant="track"
            rows={revenueRows}
            total={{ label: 'Total', amount: revenueTop.total }}
            isLoading={current.isLoading}
            error={current.error}
            testId="breakdown-staff-revenue"
          />
          <BreakdownCard
            title="Discounts granted"
            subtitle={discountTop.note}
            rows={discountRows}
            total={{ label: 'Total', amount: discountTop.total }}
            isLoading={current.isLoading}
            error={current.error}
            emptyText="No discount granted in this period."
            testId="breakdown-staff-discounts"
          />
        </div>
      </div>

      <PanelCard
        title="Staff detail"
        className="mt-3"
        isLoading={current.isLoading}
        testId="staff-performance-table"
      >
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <caption className="sr-only">
              Orders, revenue, voids, refunds, discounts and cancellations per staff member
            </caption>
            <thead>
              <tr className="border-b border-border-subtle text-text-secondary">
                <th scope="col" className="py-2 text-left">Staff</th>
                {[
                  'Orders', 'Revenue', 'AOV', 'Items/order', 'Voids', 'Voids (IDR)',
                  'Refunds', 'Refunds (IDR)', 'Disc. orders', 'Disc. (IDR)', 'Items cancelled',
                ].map((h) => (
                  <th key={h} scope="col" className="py-2 text-right">{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {sorted.map((r) => {
                const url = buildDrilldownUrl('user', r.staff_id);
                return (
                  <tr key={r.staff_id} className="border-b border-border-subtle">
                    <td className="py-2 font-medium">
                      {url !== null
                        ? <Link to={url} className={INK_LINK}>{r.staff_name}</Link>
                        : r.staff_name}
                    </td>
                    <td className={NUM_CELL}>{formatCount(r.orders_served)}</td>
                    <td className={NUM_CELL}>{formatIdrFull(r.revenue)}</td>
                    <td className={NUM_CELL}>{formatIdrFull(r.aov)}</td>
                    <td className={NUM_CELL}>{formatNumber(r.items_per_order, { digits: 1 })}</td>
                    <td className={NUM_CELL}>{formatCount(r.voids_count)}</td>
                    <td className={NUM_CELL}>{formatIdrFull(r.voids_value)}</td>
                    <td className={NUM_CELL}>{formatCount(r.refunds_count)}</td>
                    <td className={NUM_CELL}>{formatIdrFull(r.refunds_value)}</td>
                    <td className={NUM_CELL}>{formatCount(r.discount_orders_count)}</td>
                    <td className={NUM_CELL}>{formatIdrFull(r.discount_value)}</td>
                    <td className={NUM_CELL}>{formatCount(r.items_cancelled)}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </PanelCard>
    </ReportShell>
  );
}
