// apps/backoffice/src/pages/reports/SalesByStaffPage.tsx
//
// Lot D (campagne Reports 2026-08-15) — vague Sales, page 3/6. Migrée sur le
// socle Report shell v2 (archétype maquette 4c, patron : DailySalesPage).
//
// La page n'avait NI comparaison NI figure : une table nue sous un sélecteur de
// dates. Le hook accepte n'importe quelle fenêtre, donc rien n'empêchait la
// période précédente — elle est ajoutée ici, sur chaque tuile et en seconde
// série du graphe. L'appariement se fait par `staff_id`, jamais par rang : un
// classement qui bouge comparerait deux personnes différentes.

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
  BreakdownCard, type BreakdownRow,
} from '@/features/reports/components/BreakdownCard.js';
import { PairedBarsChart } from '@/features/reports/components/charts/PairedBarsChart.js';
import { useReportPeriod } from '@/features/reports/hooks/useReportPeriod.js';
import {
  useSalesByStaff, type SalesStaffRow,
} from '@/features/reports/hooks/useSalesByStaff.js';
import { buildDrilldownUrl } from '@/features/reports/utils/buildDrilldownUrl.js';
import {
  categoricalColor, formatIdrCompact, formatIdrFull,
} from '@/features/reports/utils/chartColors.js';
import {
  formatCount, formatPct1, pctChange, periodLabel, sharePct, topSlice,
} from '@/features/reports/utils/reportFigures.js';

const csvColumns: CsvColumn<SalesStaffRow>[] = [
  { header: 'Staff',       accessor: (r) => r.staff_name,  format: 'text' },
  { header: 'Revenue',     accessor: (r) => r.total,       format: 'idr-round100' },
  { header: 'Order Count', accessor: (r) => r.order_count, format: 'number' },
  { header: 'Avg Basket',  accessor: (r) => r.avg_basket,  format: 'idr-round100' },
];

const NUM_CELL = 'py-2 text-right font-data tabular-nums';
const INK_LINK = 'text-gold underline-offset-2 hover:underline focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-gold';
const MAX_BARS = 8;
const MAX_TICK_CHARS = 14;

interface KpiDescriptor {
  key: string; label: string; value: string;
  title?: string; delta?: number | null; note?: string;
}

function sumRows(rows: SalesStaffRow[]): { total: number; orders: number } {
  return rows.reduce(
    (acc, r) => ({ total: acc.total + r.total, orders: acc.orders + r.order_count }),
    { total: 0, orders: 0 },
  );
}

function truncate(s: string): string {
  return s.length > MAX_TICK_CHARS ? `${s.slice(0, MAX_TICK_CHARS - 1)}…` : s;
}

export default function SalesByStaffPage(): JSX.Element {
  // Bornes déjà nommées `start` / `end` : aucun repli de nom nécessaire.
  const period = useReportPeriod();
  const { start, end, compareRange } = period;

  const current = useSalesByStaff(start, end);
  const compare = useSalesByStaff(compareRange.start, compareRange.end);

  const rows    = useMemo(() => current.data ?? [], [current.data]);
  const cmpRows = useMemo(() => compare.data ?? [], [compare.data]);

  const sorted   = useMemo(() => rows.slice().sort((a, b) => b.total - a.total), [rows]);
  const sums     = useMemo(() => sumRows(rows), [rows]);
  const prevSums = useMemo(() => sumRows(cmpRows), [cmpRows]);

  const comparable = compare.data !== undefined ? prevSums : undefined;
  const hasCompare = period.compare && compare.data !== undefined;

  const chartData = useMemo(() => {
    const cmpMap = new Map(cmpRows.map((r) => [r.staff_id, r.total]));
    return sorted.slice(0, MAX_BARS).map((r) => ({
      staff:   r.staff_name,
      current: r.total,
      compare: cmpMap.get(r.staff_id) ?? 0,
    }));
  }, [sorted, cmpRows]);

  const top = topSlice(sorted, (r) => r.total);
  const topRows: BreakdownRow[] = top.rows.map((r, i) => {
    const url = buildDrilldownUrl('order_list', '', { served_by: r.staff_id, start, end });
    return {
      key:      r.staff_id,
      label:    r.staff_name,
      amount:   r.total,
      sharePct: sharePct(r.total, top.total),
      color:    categoricalColor(i),
      ...(url !== null ? { to: url } : {}),
    };
  });

  const avgBasket     = sums.orders > 0 ? sums.total / sums.orders : 0;
  const prevAvgBasket = comparable !== undefined && comparable.orders > 0
    ? comparable.total / comparable.orders
    : undefined;
  const leader = sorted[0];

  const tiles: KpiDescriptor[] = [
    {
      key: 'revenue', label: 'Revenue',
      value: formatIdrCompact(sums.total), title: formatIdrFull(sums.total),
      delta: pctChange(sums.total, comparable?.total),
    },
    {
      key: 'orders', label: 'Orders', value: formatCount(sums.orders),
      delta: pctChange(sums.orders, comparable?.orders),
    },
    {
      key: 'avg-basket', label: 'Avg basket',
      value: formatIdrCompact(avgBasket), title: formatIdrFull(avgBasket),
      delta: pctChange(avgBasket, prevAvgBasket),
    },
    {
      key: 'staff-count', label: 'Staff selling', value: formatCount(rows.length),
      delta: pctChange(rows.length, comparable !== undefined ? cmpRows.length : undefined),
    },
    {
      // Une variation n'a pas de sens sur un NOM : la tuile porte la part.
      key: 'top-staff', label: 'Top performer',
      value: leader?.staff_name ?? '—',
      note:  leader !== undefined
        ? `${formatPct1(sharePct(leader.total, sums.total))} of revenue`
        : 'no sale in this period',
    },
  ];

  const meta = [
    periodLabel(start, end),
    `${formatCount(rows.length)} staff member${rows.length === 1 ? '' : 's'}`,
    'revenue attributed to the cashier who served',
  ].join(' · ');

  const toolbar = (
    <>
      <PeriodControl period={period} showCompare />
      {/* PDF sans annexe de comparaison : le gabarit `sales_by_staff` n'en
          attend pas, et lui en pousser une n'est pas un geste de mise en page. */}
      <ExportMenu
        csv={{ rows, columns: csvColumns, filename: `sales-by-staff-${start}_${end}` }}
        pdf={{
          template: 'sales_by_staff',
          data:     rows,
          period:   { start, end },
          filename: `sales-by-staff-${start}_${end}`,
        }}
        disabled={rows.length === 0}
      />
    </>
  );

  return (
    <ReportShell
      title="Sales by Staff"
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
          title="Revenue by staff"
          aside={sorted.length > MAX_BARS ? (
            <span className="text-xs text-text-muted">
              Top {MAX_BARS} of {formatCount(sorted.length)}
            </span>
          ) : undefined}
          isLoading={current.isLoading}
          testId="chart-revenue-by-staff"
        >
          <PairedBarsChart
            data={chartData}
            xKey="staff"
            currentKey="current"
            currentName="This period"
            {...(hasCompare ? { compareKey: 'compare', compareName: 'Previous period' } : {})}
            xTickFormatter={(v) => truncate(String(v))}
            xTickAngle={-25}
            ariaLabel={`Revenue per staff member from ${start} to ${end}${hasCompare ? ', compared with the previous period' : ''}.`}
          />
        </PanelCard>
        <BreakdownCard
          title="Revenue share"
          subtitle={top.note}
          variant="track"
          rows={topRows}
          total={{ label: 'Total', amount: top.total }}
          isLoading={current.isLoading}
          error={current.error}
          testId="breakdown-staff"
        />
      </div>

      <PanelCard
        title="Staff detail"
        className="mt-3"
        isLoading={current.isLoading}
        testId="sbs-staff-detail"
      >
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <caption className="sr-only">Revenue, order count and average basket per staff member</caption>
            <thead>
              <tr className="border-b border-border-subtle text-text-secondary">
                <th scope="col" className="py-2 text-left">Staff</th>
                <th scope="col" className="py-2 text-right">Total</th>
                <th scope="col" className="py-2 text-right">Share</th>
                <th scope="col" className="py-2 text-right">Orders</th>
                <th scope="col" className="py-2 text-right">Avg basket</th>
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
                    <td className={NUM_CELL}>{formatIdrFull(r.total)}</td>
                    <td className={NUM_CELL}>{formatPct1(sharePct(r.total, sums.total))}</td>
                    <td className={NUM_CELL}>{formatCount(r.order_count)}</td>
                    <td className={NUM_CELL}>{formatIdrFull(r.avg_basket)}</td>
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
                  <td className={NUM_CELL}>{formatCount(sums.orders)}</td>
                  <td className={NUM_CELL}>{formatIdrFull(avgBasket)}</td>
                </tr>
              </tfoot>
            )}
          </table>
        </div>
      </PanelCard>
    </ReportShell>
  );
}
