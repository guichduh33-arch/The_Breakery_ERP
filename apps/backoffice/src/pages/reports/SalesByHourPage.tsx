// apps/backoffice/src/pages/reports/SalesByHourPage.tsx
//
// Lot D (campagne Reports 2026-08-15) — vague Sales, page 1/6. Migrée sur le
// socle Report shell v2 (archétype maquette 4c, patron : DailySalesPage).
//
// Trois points qui ne sont pas cosmétiques :
//
//  1. LE REMPLISSAGE OR EST PARTI. La barre était peinte en `--gold-base` :
//     l'or est une encre de SENS (nav active, liens, prix retail), jamais une
//     série. Le graphe passe par `PairedBarsChart`, qui trace la série normée
//     de `chartColors.ts` et sa comparaison sur le cran pâle de la même rampe.
//  2. LA JOURNÉE RESTE UNE JOURNÉE. `get_sales_by_hour_v3` prend UNE date : le
//     rapport lit le DERNIER jour de la fenêtre unifiée, et le dit dans sa
//     ligne méta — un rapport horaire agrégé sur 28 jours ne veut rien dire.
//     La comparaison est donc la veille, pas la fenêtre précédente.
//  3. Ancien lien `?date=YYYY-MM-DD` : lu en repli par `useReportPeriod`, un
//     lien copié avant l'unification ouvre toujours le bon jour.
//
// S32 / Wave 3.J — le drill-down par heure (table sous le graphe) est conservé.

import { useMemo, type JSX } from 'react';
import { Link } from 'react-router-dom';
import { previousPeriod } from '@breakery/domain';
import type { CsvColumn } from '@breakery/domain';
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
import { useSalesByHour, type SalesHourRow } from '@/features/reports/hooks/useSalesByHour.js';
import { buildDrilldownUrl } from '@/features/reports/utils/buildDrilldownUrl.js';
import { formatIdrCompact, formatIdrFull } from '@/features/reports/utils/chartColors.js';
import {
  formatCount, longDate, pctChange, sharePct, topSlice,
} from '@/features/reports/utils/reportFigures.js';

const csvColumns: CsvColumn<SalesHourRow>[] = [
  { header: 'Hour',        accessor: (r) => r.hour,        format: 'number' },
  { header: 'Revenue',     accessor: (r) => r.total,       format: 'idr-round100' },
  { header: 'Order Count', accessor: (r) => r.order_count, format: 'number' },
];

const NUM_CELL = 'py-2 text-right font-data tabular-nums';
const INK_LINK = 'text-gold underline-offset-2 hover:underline focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-gold';

interface KpiDescriptor {
  key: string; label: string; value: string;
  title?: string; delta?: number | null; note?: string;
}

function hourLabel(h: number): string {
  return `${String(h).padStart(2, '0')}:00`;
}

function sumRows(rows: SalesHourRow[]): { total: number; orders: number } {
  return rows.reduce(
    (acc, r) => ({ total: acc.total + r.total, orders: acc.orders + r.order_count }),
    { total: 0, orders: 0 },
  );
}

export default function SalesByHourPage(): JSX.Element {
  // `date` est l'ancien nom du paramètre : il alimente les DEUX bornes, donc un
  // lien copié rouvre exactement la même journée.
  const period = useReportPeriod({
    defaultPreset: 'today',
    legacyKeys: { start: 'date', end: 'date' },
  });

  // Le rapport est horaire : il lit UN jour. La fenêtre unifiée peut en porter
  // plusieurs — on prend sa borne haute, et la ligne méta le dit.
  const day     = period.end;
  const prevDay = useMemo(() => previousPeriod(day, day).end, [day]);

  const current = useSalesByHour(day);
  const compare = useSalesByHour(prevDay);

  const rows     = useMemo(() => current.data ?? [], [current.data]);
  const cmpRows  = useMemo(() => compare.data ?? [], [compare.data]);
  const sums     = useMemo(() => sumRows(rows), [rows]);
  const prevSums = useMemo(() => sumRows(cmpRows), [cmpRows]);

  // La veille est requêtée en permanence : la bande KPI promet une comparaison
  // sur chaque tuile, et sans la seconde requête elle serait décorative. Le
  // bouton « Compare » ne pilote que la SÉRIE du graphe et l'annexe du PDF.
  const comparable = compare.data !== undefined ? prevSums : undefined;
  const hasCompare = period.compare && compare.data !== undefined;

  // La comparaison s'aligne par HEURE, jamais par rang : 09:00 se compare à
  // 09:00, pas au 9ᵉ créneau non vide de la veille.
  const chartData = useMemo(() => {
    const cmpMap = new Map(cmpRows.map((r) => [r.hour, r.total]));
    return rows.map((r) => ({
      hour:    r.hour,
      current: r.total,
      compare: cmpMap.get(r.hour) ?? 0,
    }));
  }, [rows, cmpRows]);

  const active = rows.filter((r) => r.order_count > 0);
  const peak   = rows.reduce<SalesHourRow | null>(
    (best, r) => (r.total > 0 && (best === null || r.total > best.total) ? r : best),
    null,
  );

  const busiest = topSlice(
    active.slice().sort((a, b) => b.total - a.total),
    (r) => r.total,
  );
  const busiestRows: BreakdownRow[] = busiest.rows.map((r) => {
    const url = buildDrilldownUrl('order_list', '', { hour: r.hour, start: day, end: day });
    return {
      key:      String(r.hour),
      label:    hourLabel(r.hour),
      amount:   r.total,
      sharePct: sharePct(r.total, sums.total),
      count:    `${formatCount(r.order_count)} orders`,
      ...(url !== null ? { to: url } : {}),
    };
  });

  const avgBasket     = sums.orders > 0 ? sums.total / sums.orders : 0;
  const prevAvgBasket = comparable !== undefined && comparable.orders > 0
    ? comparable.total / comparable.orders
    : undefined;

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
      // Pas de variation : « l'heure de pointe a bougé de 12 % » n'a pas de sens.
      // La tuile porte une note neutre — le montant du pic.
      key: 'peak-hour', label: 'Peak hour',
      value: peak !== null ? hourLabel(peak.hour) : '—',
      note:  peak !== null ? formatIdrCompact(peak.total) : 'no sale on this day',
    },
    {
      key: 'trading-hours', label: 'Trading hours',
      value: formatCount(active.length),
      note:  'of 24 hourly buckets',
    },
  ];

  const meta = [
    longDate(day),
    period.start !== period.end ? 'last day of the selected period' : null,
    'hourly buckets, business time',
  ].filter((s): s is string => s !== null).join(' · ');

  const toolbar = (
    <>
      <PeriodControl period={period} showCompare />
      <ExportMenu
        csv={{ rows, columns: csvColumns, filename: `sales-by-hour-${day}` }}
        pdf={{
          template: 'sales_by_hour',
          data:     rows,
          period:   { start: day, end: day },
          filename: `sales-by-hour-${day}`,
          ...(hasCompare ? { comparePrevious: { data: cmpRows } } : {}),
        }}
        disabled={rows.length === 0}
      />
    </>
  );

  return (
    <ReportShell
      title="Sales by Hour"
      subtitle={meta}
      breadcrumb={[{ label: 'Reports', to: '/backoffice/reports' }, { label: 'Sales' }]}
      toolbar={toolbar}
      error={current.error}
      isEmpty={!current.isLoading && current.data !== undefined && active.length === 0}
      emptyState={{ title: 'No orders', description: 'No orders recorded for this day.' }}
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
              {t.delta !== undefined && (
                <Delta value={t.delta} period="prev day" onInk={i === 0} />
              )}
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
          title="Revenue by hour"
          aside={peak !== null ? (
            <span className="text-xs text-text-muted">
              Peak {hourLabel(peak.hour)} · {formatIdrCompact(peak.total)}
            </span>
          ) : undefined}
          isLoading={current.isLoading}
          testId="chart-revenue-by-hour"
        >
          <PairedBarsChart
            data={chartData}
            xKey="hour"
            currentKey="current"
            currentName="This day"
            {...(hasCompare ? { compareKey: 'compare', compareName: 'Previous day' } : {})}
            xTickFormatter={(v) => hourLabel(Number(v))}
            ariaLabel={`Revenue per hour on ${day}, 24 hourly buckets${hasCompare ? ', compared with the previous day' : ''}.`}
          />
        </PanelCard>
        <BreakdownCard
          title="Busiest hours"
          subtitle={busiest.note ?? 'Share of the day’s revenue.'}
          variant="track"
          rows={busiestRows}
          total={{ label: 'Total', amount: busiest.total }}
          isLoading={current.isLoading}
          error={current.error}
          emptyText="No hour recorded a sale on this day."
          testId="breakdown-busiest-hours"
        />
      </div>

      {/* Drill-down par heure (S32 Wave 3.J) — chaque heure ouvre la liste des
          commandes filtrée sur ce créneau et cette journée. */}
      <PanelCard
        title="Per-hour detail"
        className="mt-3"
        isLoading={current.isLoading}
        testId="sbh-hour-detail"
      >
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <caption className="sr-only">Revenue and order count per hour</caption>
            <thead>
              <tr className="border-b border-border-subtle text-text-secondary">
                <th scope="col" className="py-2 text-left">Hour</th>
                <th scope="col" className="py-2 text-right">Revenue</th>
                <th scope="col" className="py-2 text-right">Orders</th>
              </tr>
            </thead>
            <tbody>
              {active.map((r) => {
                const url = buildDrilldownUrl('order_list', '', { hour: r.hour, start: day, end: day });
                return (
                  <tr key={r.hour} className="border-b border-border-subtle">
                    <td className="py-2 font-data font-medium tabular-nums">
                      {url !== null
                        ? <Link to={url} className={INK_LINK}>{hourLabel(r.hour)}</Link>
                        : hourLabel(r.hour)}
                    </td>
                    <td className={NUM_CELL}>{formatIdrFull(r.total)}</td>
                    <td className={NUM_CELL}>{formatCount(r.order_count)}</td>
                  </tr>
                );
              })}
            </tbody>
            {active.length > 0 && (
              <tfoot>
                <tr className="border-t border-border-subtle font-semibold">
                  <td className="py-2">Total</td>
                  <td className={NUM_CELL}>{formatIdrFull(sums.total)}</td>
                  <td className={NUM_CELL}>{formatCount(sums.orders)}</td>
                </tr>
              </tfoot>
            )}
          </table>
        </div>
      </PanelCard>
    </ReportShell>
  );
}
