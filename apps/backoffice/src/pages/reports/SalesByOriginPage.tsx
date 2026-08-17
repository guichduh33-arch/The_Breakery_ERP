// apps/backoffice/src/pages/reports/SalesByOriginPage.tsx
//
// « Sales by Origin — P / T1 / T2 / BO » — d'où viennent les ventes. Famille
// Sales, archétype Report (socle Report shell v2) ; patron :
// DiscountsLoyaltyPage. Question tranchée : « d'où viennent mes ventes —
// comptoir, tablettes salle, back-office — et l'équilibre bouge-t-il ? »
// (maquette + arbitrages validés par Mamat le 2026-08-17).
//
// TROIS CHOSES QUE CETTE PAGE DIT ET QU'AUCUNE AUTRE NE DISAIT :
//
//  1. L'ORIGINE EST DANS LE NUMÉRO. La numérotation source-codée (2026-08-16)
//     encode la porte d'entrée de chaque commande — aucun rapport ne
//     distinguait le comptoir des tablettes ni du back-office.
//  2. LE B2B EST DU BACK-OFFICE, STRUCTURELLEMENT. create_b2b_order pose le
//     code BO en dur (arbitrage : pas de 5ᵉ origine).
//  3. LE PÉRIMÈTRE COMMENCE AU CUTOVER. Les commandes pré-numérotation sont
//     EXCLUES (arbitrage : pas de bucket Historique) — sur une période à
//     cheval, le total peut différer des autres rapports de ventes ; la
//     réserve le dit au lieu de le laisser deviner.

import { useMemo, type JSX } from 'react';
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
import {
  StackedBarsChart, type StackedSeries,
} from '@/features/reports/components/charts/StackedBarsChart.js';
import { useReportPeriod } from '@/features/reports/hooks/useReportPeriod.js';
import {
  useSalesByOrigin, type OriginRow,
} from '@/features/reports/hooks/useSalesByOrigin.js';
import {
  categoricalColor, formatIdrCompact, formatIdrFull,
} from '@/features/reports/utils/chartColors.js';
import {
  eachDay, formatCount, formatPct1, pctChange, periodLabel, shortDate, sharePct,
} from '@/features/reports/utils/reportFigures.js';

/** Ordre d'IDENTITÉ des origines — couleurs et empilement le suivent, jamais
 *  le rang par valeur. Une origine inattendue (T3…) s'ajoute à la suite avec
 *  son code brut : le groupement serveur est dynamique. */
const KNOWN_ORIGINS = [
  { key: 'P',  label: 'Counter (P)' },
  { key: 'T1', label: 'Tablet 1 (T1)' },
  { key: 'T2', label: 'Tablet 2 (T2)' },
  { key: 'BO', label: 'Back-office (BO)' },
] as const;

function originLabel(code: string): string {
  return KNOWN_ORIGINS.find((o) => o.key === code)?.label ?? code;
}

const csvColumns: CsvColumn<OriginRow>[] = [
  { header: 'Origin',     accessor: (r) => originLabel(r.origin), format: 'text' },
  { header: 'Orders',     accessor: (r) => r.orders,              format: 'number' },
  { header: 'Revenue',    accessor: (r) => r.revenue,             format: 'idr-round100' },
  { header: 'Avg ticket', accessor: (r) => r.avg_ticket,          format: 'idr-round100' },
  { header: 'Discounts',  accessor: (r) => r.discount_total,      format: 'idr-round100' },
  { header: 'Revenue prev', accessor: (r) => r.revenue_prev,      format: 'idr-round100' },
];

const NUM_CELL = 'py-2 text-right font-data tabular-nums';

export default function SalesByOriginPage(): JSX.Element {
  const period = useReportPeriod();
  const { start, end } = period;

  const report = useSalesByOrigin({ start, end });
  const summary = report.data?.summary;
  const origins = report.data?.by_origin ?? [];

  // Ordre stable : les origines connues d'abord, l'inattendu à la suite.
  const orderedOrigins = useMemo(() => {
    const known = KNOWN_ORIGINS.map((k) => k.key as string);
    return [...origins].sort((a, b) => {
      const ia = known.indexOf(a.origin); const ib = known.indexOf(b.origin);
      return (ia === -1 ? known.length : ia) - (ib === -1 ? known.length : ib);
    });
  }, [origins]);

  const stackSeries: StackedSeries[] = useMemo(
    () => orderedOrigins.map((o, i) => ({
      key: o.origin, name: originLabel(o.origin), color: categoricalColor(i),
    })),
    [orderedOrigins],
  );

  // by_day (format long) → semaines de 7 jours × colonnes par origine.
  const weekly = useMemo(() => {
    const byDay = new Map<string, Map<string, number>>();
    for (const d of report.data?.by_day ?? []) {
      const m = byDay.get(d.date) ?? new Map<string, number>();
      m.set(d.origin, (m.get(d.origin) ?? 0) + d.revenue);
      byDay.set(d.date, m);
    }
    const days = eachDay(start, end);
    const out: Record<string, unknown>[] = [];
    for (let i = 0; i < days.length; i += 7) {
      const chunk = days.slice(i, i + 7);
      const first = chunk[0];
      if (first === undefined) break;
      const row: Record<string, number | string> = { label: shortDate(first) };
      for (const o of orderedOrigins) row[o.origin] = 0;
      for (const d of chunk) {
        const m = byDay.get(d);
        if (m === undefined) continue;
        for (const [origin, rev] of m) {
          row[origin] = ((row[origin] as number | undefined) ?? 0) + rev;
        }
      }
      out.push(row);
    }
    return out;
  }, [report.data, start, end, orderedOrigins]);

  const share = (code: string): number | null => {
    if (summary === undefined || summary.total_revenue <= 0) return null;
    const row = origins.find((o) => o.origin === code);
    return row !== undefined ? (row.revenue / summary.total_revenue) * 100 : 0;
  };
  const sharePrev = (codes: string[]): number | null => {
    if (summary === undefined || summary.total_revenue_prev <= 0) return null;
    const rev = origins
      .filter((o) => codes.includes(o.origin))
      .reduce((s, o) => s + o.revenue_prev, 0);
    return (rev / summary.total_revenue_prev) * 100;
  };
  const shareGroup = (codes: string[]): number | null => {
    if (summary === undefined || summary.total_revenue <= 0) return null;
    const rev = origins
      .filter((o) => codes.includes(o.origin))
      .reduce((s, o) => s + o.revenue, 0);
    return (rev / summary.total_revenue) * 100;
  };

  const ptsNote = (cur: number | null, prev: number | null): string => {
    if (cur === null) return 'no revenue in this period';
    if (prev === null) return 'no previous-window revenue';
    const d = cur - prev;
    return `${d >= 0 ? '+' : '−'}${Math.abs(d).toLocaleString('id-ID', { maximumFractionDigits: 1 })} pts vs previous`;
  };

  const counterShare = share('P');
  const floorShare   = shareGroup(['T1', 'T2']);
  const boShare      = share('BO');

  const tiles = [
    {
      key: 'revenue', label: 'Revenue (source-coded)',
      value: formatIdrCompact(summary?.total_revenue ?? 0),
      title: formatIdrFull(summary?.total_revenue ?? 0),
      delta: pctChange(summary?.total_revenue ?? 0, summary?.total_revenue_prev ?? 0),
      note:  `${formatCount(summary?.total_orders ?? 0)} orders`,
    },
    {
      key: 'counter', label: 'Counter share (P)',
      value: counterShare === null ? '—' : formatPct1(counterShare),
      note:  ptsNote(counterShare, sharePrev(['P'])),
    },
    {
      key: 'floor', label: 'Floor share (T1+T2)',
      value: floorShare === null ? '—' : formatPct1(floorShare),
      note:  ptsNote(floorShare, sharePrev(['T1', 'T2'])),
    },
    {
      key: 'bo', label: 'Back-office share (BO)',
      value: boShare === null ? '—' : formatPct1(boShare),
      note:  ptsNote(boShare, sharePrev(['BO'])),
    },
  ];

  const meta = [
    periodLabel(start, end),
    'source-coded orders only, vs the previous window of same length',
  ].join(' · ');

  const toolbar = (
    <>
      <PeriodControl period={period} />
      <ExportMenu
        csv={{ rows: orderedOrigins, columns: csvColumns, filename: `sales-by-origin-${start}_${end}` }}
        disabled={origins.length === 0}
      />
    </>
  );

  const isEmpty = !report.isLoading && report.data !== undefined
    && (summary?.total_orders ?? 0) === 0;

  return (
    <ReportShell
      title="Sales by Origin"
      subtitle={meta}
      breadcrumb={[{ label: 'Reports', to: '/backoffice/reports' }, { label: 'Sales' }]}
      toolbar={toolbar}
      error={report.error}
      isEmpty={isEmpty}
      emptyState={{
        title: 'No source-coded sale',
        description: 'No order carrying the origin-coded number in this date range — the numbering went live on 2026-08-16.',
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
        <strong>Source-coded orders only.</strong> The origin is read from the order
        number (<code>P/T1/T2/BO + date + sequence</code>, live since 2026-08-16); B2B
        orders carry BO structurally. Orders numbered before the cutover are excluded —
        on a straddling period this total will differ from the other sales reports.
        Canonical sales scope otherwise (paid, non-voided, no historical imports).
      </p>

      <div className="mt-3 grid gap-3 xl:grid-cols-[1.7fr_1fr]">
        <PanelCard
          title="Revenue per origin, weekly"
          aside={<span className="text-xs text-text-muted">Served daily, folded into weeks</span>}
          isLoading={report.isLoading}
          testId="chart-origin-weekly"
        >
          <StackedBarsChart
            data={weekly}
            xKey="label"
            series={stackSeries}
            ariaLabel={`Revenue per order origin, stacked per week from ${start} to ${end}.`}
          />
        </PanelCard>
        <BreakdownCard
          title="By origin"
          subtitle="Volume tells one story, ticket size another."
          variant="track"
          rows={orderedOrigins.map((o, i): BreakdownRow => ({
            key:      o.origin,
            label:    originLabel(o.origin),
            amount:   o.revenue,
            sharePct: sharePct(o.revenue, summary?.total_revenue ?? 0),
            count:    `${formatCount(o.orders)} orders · avg ${formatIdrCompact(o.avg_ticket)}`,
            color:    categoricalColor(i),
          }))}
          total={{ label: 'Total revenue', amount: summary?.total_revenue ?? 0 }}
          isLoading={report.isLoading}
          error={report.error}
          shareBar={{
            title:     'Share of revenue',
            ariaLabel: 'Share of revenue by order origin',
            segments:  orderedOrigins.map((o, i): ShareSegment => ({
              label: originLabel(o.origin),
              pct:   sharePct(o.revenue, summary?.total_revenue ?? 0) ?? 0,
              color: categoricalColor(i),
            })),
          }}
          emptyText="No source-coded sale in this period."
          testId="breakdown-origins"
        />
      </div>

      <PanelCard
        title="Per origin"
        aside={<span className="text-xs text-text-muted">Discounts = order-level levers (detail lives in Discounts &amp; Loyalty)</span>}
        className="mt-3"
        isLoading={report.isLoading}
        testId="origin-table"
      >
        {origins.length === 0 ? (
          <p className="py-6 text-center text-sm text-text-muted">
            No source-coded sale in this period.
          </p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <caption className="sr-only">
                Orders, revenue, average ticket and discounts per order origin
              </caption>
              <thead>
                <tr className="border-b border-border-subtle text-text-secondary">
                  <th className="py-2 pr-3 text-left font-normal">Origin</th>
                  <th className="py-2 pr-3 text-right font-normal">Orders</th>
                  <th className="py-2 pr-3 text-right font-normal">Revenue</th>
                  <th className="py-2 pr-3 text-right font-normal">vs prev</th>
                  <th className="py-2 pr-3 text-right font-normal">Avg ticket</th>
                  <th className="py-2 pr-3 text-right font-normal">Discounts</th>
                </tr>
              </thead>
              <tbody>
                {orderedOrigins.map((o) => {
                  const d = pctChange(o.revenue, o.revenue_prev);
                  return (
                    <tr key={o.origin} className="border-b border-border-subtle">
                      <td className="py-2">{originLabel(o.origin)}</td>
                      <td className={NUM_CELL}>{formatCount(o.orders)}</td>
                      <td className={cnRevenue}>{formatIdrFull(o.revenue)}</td>
                      <td className={NUM_CELL}>
                        {d === null ? '—' : `${d >= 0 ? '+' : ''}${d.toLocaleString('id-ID', { maximumFractionDigits: 1 })}%`}
                      </td>
                      <td className={NUM_CELL}>{formatIdrFull(o.avg_ticket)}</td>
                      <td className={NUM_CELL}>{formatIdrFull(o.discount_total)}</td>
                    </tr>
                  );
                })}
              </tbody>
              <tfoot>
                <tr className="border-t border-border-subtle font-semibold">
                  <td className="py-2">Total</td>
                  <td className={NUM_CELL}>{formatCount(summary?.total_orders ?? 0)}</td>
                  <td className={NUM_CELL}>{formatIdrFull(summary?.total_revenue ?? 0)}</td>
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

const cnRevenue = 'py-2 text-right font-data tabular-nums font-semibold';
