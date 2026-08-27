// apps/backoffice/src/pages/reports/SalesByTablePage.tsx
//
// « Sales by Table » — quelles tables travaillent. Famille Sales, archétype
// Report (socle Report shell v2) ; patron : SalesByOriginPage. Question
// tranchée : « quelles tables tournent, lesquelles dorment — et le patio
// vaut-il ses couverts ? » (maquette + arbitrages validés par Mamat le
// 2026-08-17 : heatmap en NOMBRE DE COMMANDES, dine-in sans table exclues).
//
// TROIS CHOSES QUE CETTE PAGE DIT ET QU'AUCUNE AUTRE NE DISAIT :
//
//  1. LA TABLE COMME DIMENSION. Le CA de salle existait en bloc ; aucune vue
//     ne le posait table par table, avec les couverts en face.
//  2. OÙ ÇA TOURNE, PAS OÙ ÇA FACTURE. La matrice table × jour est en
//     COMMANDES (arbitrage) — le CA vit dans le tooltip et le Pareto à côté.
//  3. LE PÉRIMÈTRE EST HONNÊTE. Une dine-in sans table est un cas non
//     autorisé : exclue, et la réserve le dit.
//
// La matrice est rendue ICI en table accessible teintée à la rampe
// SÉQUENTIELLE du thème (chart-4 → chart-1) : HeatmapGrid porte le barème
// d'ÉTAT varianceScale (good/watch/bad) — un contresens pour de l'intensité
// d'activité. Un composant partagé d'intensité naîtra quand un second rapport
// en aura besoin.

import { useMemo, type JSX } from 'react';
import { cn } from '@breakery/ui';
import type { CsvColumn } from '@breakery/domain';
import { PanelCard } from '@/components/PanelCard.js';
import { KpiTile, KPI_NOTE, KPI_NOTE_HERO } from '@/components/kpi/KpiTile.js';
import { Delta } from '@/components/kpi/Delta.js';
import { ReportShell } from '@/features/reports/components/ReportShell.js';
import { KpiBand } from '@/features/reports/components/KpiBand.js';
import { PeriodControl } from '@/features/reports/components/PeriodControl.js';
import { ExportMenu } from '@/features/reports/components/ExportMenu.js';
import { ParetoChart } from '@/features/reports/components/charts/ParetoChart.js';
import { useReportPeriod } from '@/features/reports/hooks/useReportPeriod.js';
import {
  useSalesByTable, type TableRow,
} from '@/features/reports/hooks/useSalesByTable.js';
import { formatIdrCompact, formatIdrFull } from '@/features/reports/utils/chartColors.js';
import {
  eachDay, formatCount, pctChange, periodLabel,
} from '@/features/reports/utils/reportFigures.js';

const csvColumns: CsvColumn<TableRow>[] = [
  { header: 'Table',      accessor: (r) => r.table_number,   format: 'text' },
  { header: 'Seats',      accessor: (r) => r.seats ?? '',    format: 'number' },
  { header: 'Orders',     accessor: (r) => r.orders,         format: 'number' },
  { header: 'Revenue',    accessor: (r) => r.revenue,        format: 'idr-round100' },
  { header: 'Avg ticket', accessor: (r) => r.avg_ticket,     format: 'idr-round100' },
  { header: 'Revenue prev', accessor: (r) => r.revenue_prev, format: 'idr-round100' },
];

const NUM_CELL = 'py-2 text-right font-data tabular-nums';
/** Lundi-premier, libellés ISO 1..7. */
const DOW_LABELS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
/** Rampe séquentielle du thème — l'intensité EST la mesure, jamais un état. */
const INTENSITY_VARS = ['var(--chart-4)', 'var(--chart-3)', 'var(--chart-2)', 'var(--chart-1)'];
const PARETO_SHOWN = 10;

export default function SalesByTablePage(): JSX.Element {
  const period = useReportPeriod();
  const { start, end } = period;

  const report = useSalesByTable({ start, end });
  const summary = report.data?.summary;
  // Stabilisée : consommée par les useMemo de la matrice et du Pareto.
  const tables  = useMemo(() => report.data?.by_table ?? [], [report.data]);

  // Matrice table × jour ISO — cellules { orders, revenue }.
  const matrix = useMemo(() => {
    const rows = new Map<string, { orders: number; revenue: number }[]>();
    for (const t of tables) rows.set(t.table_number, Array.from({ length: 7 }, () => ({ orders: 0, revenue: 0 })));
    let max = 0;
    for (const d of report.data?.by_table_dow ?? []) {
      const row = rows.get(d.table_number);
      if (row === undefined || d.dow < 1 || d.dow > 7) continue;
      const cell = row[d.dow - 1];
      if (cell === undefined) continue;
      cell.orders += d.orders;
      cell.revenue += d.revenue;
      if (cell.orders > max) max = cell.orders;
    }
    return { rows, max };
  }, [tables, report.data]);

  const dayCount = useMemo(() => eachDay(start, end).length, [start, end]);
  const rotation = summary !== undefined && summary.tables_used > 0 && dayCount > 0
    ? summary.orders / summary.tables_used / dayCount
    : null;
  const perSeat = summary !== undefined && summary.active_seats > 0
    ? summary.revenue / summary.active_seats
    : null;

  const paretoRows = useMemo(
    () => tables.slice(0, PARETO_SHOWN).map((t) => ({ name: t.table_number, value: t.revenue })),
    [tables],
  );

  const tiles = [
    {
      key: 'revenue', label: 'Floor revenue',
      value: formatIdrCompact(summary?.revenue ?? 0),
      title: formatIdrFull(summary?.revenue ?? 0),
      delta: pctChange(summary?.revenue ?? 0, summary?.revenue_prev ?? 0),
      note:  `${formatCount(summary?.orders ?? 0)} table orders`,
    },
    {
      key: 'rotation', label: 'Rotation',
      value: rotation !== null
        ? rotation.toLocaleString('id-ID', { maximumFractionDigits: 1 })
        : '—',
      note:  'orders / used table / day',
    },
    {
      key: 'tables', label: 'Tables used',
      value: `${formatCount(summary?.tables_used ?? 0)} / ${formatCount(summary?.active_tables ?? 0)}`,
      note:  'of the active floor plan',
    },
    {
      key: 'ticket', label: 'Avg table ticket',
      value: summary !== undefined && summary.orders > 0
        ? formatIdrCompact(summary.revenue / summary.orders)
        : '—',
      note:  'per order, floor only',
    },
    {
      key: 'per-seat', label: 'Revenue per seat',
      value: perSeat !== null ? formatIdrCompact(perSeat) : '—',
      note:  `over ${formatCount(summary?.active_seats ?? 0)} active seats`,
    },
  ];

  const meta = [
    periodLabel(start, end),
    'dine-in orders with a table, vs the previous window of same length',
  ].join(' · ');

  const toolbar = (
    <>
      <PeriodControl period={period} />
      <ExportMenu
        csv={{ rows: tables, columns: csvColumns, filename: `sales-by-table-${start}_${end}` }}
        disabled={tables.length === 0}
      />
    </>
  );

  const isEmpty = !report.isLoading && report.data !== undefined
    && (summary?.orders ?? 0) === 0;

  return (
    <ReportShell
      title="Sales by Table"
      subtitle={meta}
      breadcrumb={[{ label: 'Reports', to: '/backoffice/reports' }, { label: 'Sales' }]}
      toolbar={toolbar}
      error={report.error}
      isEmpty={isEmpty}
      emptyState={{
        title: 'No table order',
        description: 'No dine-in order carrying a table number in the selected date range.',
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
              {t.delta !== undefined && <Delta value={t.delta} period="prev" onInk={i === 0} />}
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
        <strong>Floor orders only.</strong> Dine-in orders carrying a table number —
        a table-less dine-in is a disallowed case and enters nothing. Tables join by
        name: a renamed table keeps its history visible, seats blank. The matrix shows
        <em> order counts</em> (where it turns); revenue lives in the tooltip and the
        Pareto beside it.
      </p>

      <div className="mt-3 grid gap-3 xl:grid-cols-[1.7fr_1fr]">
        <PanelCard
          title="Where it turns — table × weekday"
          aside={<span className="text-xs text-text-muted">Order counts · darker = busier · revenue in the tooltip</span>}
          isLoading={report.isLoading}
          testId="table-dow-matrix"
        >
          {matrix.rows.size === 0 ? (
            <p className="py-6 text-center text-sm text-text-muted">
              No table order in this period.
            </p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <caption className="sr-only">
                  Order count per table and weekday — darker cells are busier
                </caption>
                <thead>
                  <tr className="border-b border-border-subtle text-text-secondary">
                    <th scope="col" className="py-2 text-left font-normal">Table</th>
                    {DOW_LABELS.map((d) => (
                      <th scope="col" key={d} className="py-2 text-right font-data text-xs font-semibold uppercase tracking-widest">
                        {d}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {[...matrix.rows.entries()].map(([table, cells]) => (
                    <tr key={table} className="border-b border-border-muted">
                      <th scope="row" className="py-1.5 pr-2 text-left font-normal">{table}</th>
                      {cells.map((c, i) => {
                        const step = c.orders > 0 && matrix.max > 0
                          ? Math.min(3, Math.floor((c.orders / matrix.max) * 4))
                          : null;
                        return (
                          <td key={i} className="p-0.5 text-right">
                            <span
                              className={cn(
                                'block rounded-sm px-2 py-1.5 font-data text-xs tabular-nums',
                                step === null && 'text-text-subtle',
                                // Le premier plan d'un aplat est un TOKEN, jamais
                                // `text-white` en dur (DESIGN.md, dernier Don't) —
                                // même retrait que DeleteUserDialog et
                                // EditOrderItemsModal. Et le blanc ne tenait pas :
                                // sur `--chart-2` (#4f93bf) il rendait 3,3:1, sous
                                // le 4,5:1 qu'exige du texte à 12 px.
                                //
                                // Le SEUIL suit donc la rampe, pas un cran unique :
                                //   step 3 · --chart-1 #2b6c9c → --ink-fg  ≈ 5,5:1
                                //   step 2 · --chart-2 #4f93bf → texte encre ≈ 5,2:1
                                //   steps 0-1 · #c9dcea / #8cc3e0 → hérité ≥ 9:1
                                // Les deux crans clairs gardent la couleur du corps :
                                // rien à écrire, rien à surveiller.
                                step === 3 && 'text-ink-fg',
                                step === 2 && 'text-text-primary',
                              )}
                              style={step !== null ? { background: INTENSITY_VARS[step] } : undefined}
                              title={c.orders > 0
                                ? `${table} · ${DOW_LABELS[i]}: ${c.orders} orders · ${formatIdrFull(c.revenue)}`
                                : undefined}
                            >
                              {c.orders > 0 ? c.orders : '—'}
                            </span>
                          </td>
                        );
                      })}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </PanelCard>
        <PanelCard
          title="Revenue per table"
          aside={
            <span className="text-xs text-text-muted">
              Top {paretoRows.length} of {formatCount(tables.length)} · cumulative share
            </span>
          }
          isLoading={report.isLoading}
          testId="chart-table-pareto"
        >
          <ParetoChart
            data={paretoRows}
            xKey="name"
            valueKey="value"
            valueName="Revenue"
            grandTotal={summary?.revenue ?? 0}
            ariaLabel="Revenue per table, sorted descending with cumulative share."
          />
        </PanelCard>
      </div>

      <PanelCard
        title="Per table"
        aside={<span className="text-xs text-text-muted">Seats join by table name — a renamed table shows blank seats</span>}
        className="mt-3"
        isLoading={report.isLoading}
        testId="table-table"
      >
        {tables.length === 0 ? (
          <p className="py-6 text-center text-sm text-text-muted">
            No table order in this period.
          </p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <caption className="sr-only">
                Orders, revenue and average ticket per floor table
              </caption>
              <thead>
                <tr className="border-b border-border-subtle text-text-secondary">
                  <th scope="col" className="py-2 pr-3 text-left font-normal">Table</th>
                  <th scope="col" className="py-2 pr-3 text-right font-normal">Seats</th>
                  <th scope="col" className="py-2 pr-3 text-right font-normal">Orders</th>
                  <th scope="col" className="py-2 pr-3 text-right font-normal">Revenue</th>
                  <th scope="col" className="py-2 pr-3 text-right font-normal">vs prev</th>
                  <th scope="col" className="py-2 pr-3 text-right font-normal">Avg ticket</th>
                  <th scope="col" className="py-2 pr-3 text-right font-normal">Revenue / seat</th>
                </tr>
              </thead>
              <tbody>
                {tables.map((t) => {
                  const d = pctChange(t.revenue, t.revenue_prev);
                  return (
                    <tr key={t.table_number} className="border-b border-border-subtle">
                      <td className="py-2">{t.table_number}</td>
                      <td className={NUM_CELL}>{t.seats ?? '—'}</td>
                      <td className={NUM_CELL}>{formatCount(t.orders)}</td>
                      <td className={cn(NUM_CELL, 'font-semibold')}>{formatIdrFull(t.revenue)}</td>
                      <td className={NUM_CELL}>
                        {d === null ? '—' : `${d >= 0 ? '+' : ''}${d.toLocaleString('id-ID', { maximumFractionDigits: 1 })}%`}
                      </td>
                      <td className={NUM_CELL}>{formatIdrFull(t.avg_ticket)}</td>
                      <td className={NUM_CELL}>
                        {t.seats !== null && t.seats > 0 ? formatIdrFull(t.revenue / t.seats) : '—'}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
              <tfoot>
                <tr className="border-t border-border-subtle font-semibold">
                  <td className="py-2">Total</td>
                  <td className={NUM_CELL} />
                  <td className={NUM_CELL}>{formatCount(summary?.orders ?? 0)}</td>
                  <td className={NUM_CELL}>{formatIdrFull(summary?.revenue ?? 0)}</td>
                  <td className={NUM_CELL} colSpan={3} />
                </tr>
              </tfoot>
            </table>
          </div>
        )}
      </PanelCard>
    </ReportShell>
  );
}
