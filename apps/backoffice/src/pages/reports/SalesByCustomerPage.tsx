// apps/backoffice/src/pages/reports/SalesByCustomerPage.tsx
//
// « Sales by Customer » — qui compte, qui décroche. Famille Sales, archétype
// Report (socle Report shell v2) ; patron : SalesByProductPage. Question
// tranchée : « qui sont mes clients qui comptent, et lesquels décrochent ? »
// (conception validée par Mamat le 2026-08-16).
//
// TROIS CHOSES QUE CETTE PAGE DIT ET QU'AUCUNE AUTRE NE DISAIT :
//
//  1. IDENTIFIÉ = CAPTURE, PAS CLIENTÈLE. L'anonyme n'est pas « de petits
//     clients », c'est du comptoir sans carte : la part identifiée mesure la
//     performance de capture — et le panier identifié vs anonyme en donne
//     l'argument chiffré.
//  2. LE DÉCROCHAGE EST UNE LISTE, PAS UN SCORE. ≥ N achats la fenêtre
//     précédente (constante domain), zéro depuis : des noms à relancer, avec
//     le CA à risque — les segments RFM et cohortes restent dans Marketing.
//  3. LE B2B EST COMPTÉ ET BADGÉ. Six comptes peuvent porter la moitié de
//     l'identifié — la concentration se lit dans le Pareto ; l'encours, lui,
//     vit dans le module B2B.
//
// Grain de la tendance : SEMAINE (arbitrage Mamat) — trente jours découpés en
// deux séries journalières seraient du bruit ; la donnée reste servie au jour
// (by_day) et l'agrégation en semaines est un pli d'affichage.

import { useMemo, type JSX } from 'react';
import { Link } from 'react-router-dom';
import { Badge, selectClassName, cn } from '@breakery/ui';
import type { CsvColumn } from '@breakery/domain';
import { PanelCard } from '@/components/PanelCard.js';
import { KpiTile, KPI_NOTE, KPI_NOTE_HERO } from '@/components/kpi/KpiTile.js';
import { Delta } from '@/components/kpi/Delta.js';
import { FOCUS_RING } from '@/components/focusRing.js';
import { ReportShell } from '@/features/reports/components/ReportShell.js';
import { KpiBand } from '@/features/reports/components/KpiBand.js';
import { PeriodControl } from '@/features/reports/components/PeriodControl.js';
import { ExportMenu } from '@/features/reports/components/ExportMenu.js';
import { SortableTh } from '@/features/reports/components/SortableTh.js';
import {
  BreakdownCard, type BreakdownRow, type ShareSegment,
} from '@/features/reports/components/BreakdownCard.js';
import { ParetoChart } from '@/features/reports/components/charts/ParetoChart.js';
import {
  StackedBarsChart, type StackedSeries,
} from '@/features/reports/components/charts/StackedBarsChart.js';
import { useReportPeriod } from '@/features/reports/hooks/useReportPeriod.js';
import { useSortedRows, type SortSpec } from '@/features/reports/hooks/useSortedRows.js';
import {
  useSalesByCustomer, type CustomerSalesRow,
} from '@/features/reports/hooks/useSalesByCustomer.js';
import { useUrlState } from '@/hooks/useUrlState.js';
import { buildDrilldownUrl } from '@/features/reports/utils/buildDrilldownUrl.js';
import {
  CHART_1, CHART_3, CHART_4, formatIdrCompact, formatIdrFull,
} from '@/features/reports/utils/chartColors.js';
import {
  eachDay, formatCount, formatPct1, pctChange, periodLabel, sharePct, shortDate,
} from '@/features/reports/utils/reportFigures.js';

const csvColumns: CsvColumn<CustomerSalesRow>[] = [
  { header: 'Customer',    accessor: (r) => r.name,                        format: 'text' },
  { header: 'Type',        accessor: (r) => r.customer_type,               format: 'text' },
  { header: 'Orders',      accessor: (r) => r.order_count,                 format: 'number' },
  { header: 'Revenue',     accessor: (r) => r.revenue,                     format: 'idr-round100' },
  { header: 'Avg basket',  accessor: (r) => r.order_count > 0 ? Math.round(r.revenue / r.order_count) : 0, format: 'idr-round100' },
  { header: 'Prev revenue', accessor: (r) => r.revenue_prev ?? '',         format: 'number' },
  { header: 'Last order',  accessor: (r) => r.last_order_date,             format: 'text' },
  { header: 'New',         accessor: (r) => (r.is_new ? 'yes' : ''),       format: 'text' },
  { header: 'Points',      accessor: (r) => r.loyalty_points,              format: 'number' },
];

const NUM_CELL = 'py-2 text-right font-data tabular-nums';
/** Au-delà, l'axe du Pareto devient une frise illisible. */
const MAX_BARS = 8;
const MAX_TICK_CHARS = 12;
/** Lignes visibles du panneau décrochage — la liste entière part au CSV. */
const CHURN_SHOWN = 5;

function truncate(s: string): string {
  return s.length > MAX_TICK_CHARS ? `${s.slice(0, MAX_TICK_CHARS - 1)}…` : s;
}

type SortKey = 'name' | 'type' | 'orders' | 'revenue' | 'basket' | 'delta' | 'last' | 'points';

/** Défini au niveau module : une identité neuve à chaque rendu retrierait sans fin. */
const SORT_SPECS: Readonly<Record<SortKey, SortSpec<CustomerSalesRow>>> = {
  name:    { kind: 'string', value: (r) => r.name },
  type:    { kind: 'string', value: (r) => r.customer_type },
  orders:  { kind: 'number', value: (r) => r.order_count },
  revenue: { kind: 'number', value: (r) => r.revenue },
  basket:  { kind: 'number', value: (r) => (r.order_count > 0 ? r.revenue / r.order_count : 0) },
  delta:   {
    kind: 'number',
    value: (r) => r.revenue_prev !== null && r.revenue_prev > 0
      ? (r.revenue - r.revenue_prev) / r.revenue_prev
      : Number.NEGATIVE_INFINITY,
  },
  last:    { kind: 'string', value: (r) => r.last_order_date },
  points:  { kind: 'number', value: (r) => r.loyalty_points },
};

/** Pile identifié/anonyme : l'identifié sature, l'anonyme est le FOND — le cran
 *  pâle de la même rampe, pas une seconde identité catégorielle. */
const STACK_SERIES: StackedSeries[] = [
  { key: 'identified', name: 'Identified', color: CHART_1 },
  { key: 'anonymous',  name: 'Anonymous',  color: CHART_4 },
];

interface KpiDescriptor {
  key: string; label: string; value: string;
  title?: string; delta?: number | null; note?: string;
}

export default function SalesByCustomerPage(): JSX.Element {
  const period = useReportPeriod();
  const { start, end } = period;
  const [typeFilter, setTypeFilter] = useUrlState('customer_type', '');

  const report = useSalesByCustomer({
    start, end,
    customerType: typeFilter === 'retail' || typeFilter === 'b2b' ? typeFilter : null,
  });

  const rows    = useMemo(() => report.data?.by_customer ?? [], [report.data]);
  const churned = report.data?.churned ?? [];
  const summary = report.data?.summary;

  const sorted = useSortedRows<CustomerSalesRow, SortKey>(rows, SORT_SPECS);

  // ── Semaines : by_day (jour) plié en fenêtres de 7 jours depuis le début —
  //    le zéro-fill vient d'eachDay, comme partout dans le module. ────────────
  const weekly = useMemo(() => {
    const byDate = new Map((report.data?.by_day ?? []).map((d) => [d.date, d]));
    const days = eachDay(start, end);
    const out: { label: string; identified: number; anonymous: number }[] = [];
    for (let i = 0; i < days.length; i += 7) {
      const chunk = days.slice(i, i + 7);
      const first = chunk[0];
      if (first === undefined) break;
      let identified = 0;
      let anonymous = 0;
      for (const d of chunk) {
        const row = byDate.get(d);
        identified += row?.identified ?? 0;
        anonymous  += row?.anonymous ?? 0;
      }
      out.push({ label: shortDate(first), identified, anonymous });
    }
    return out;
  }, [report.data, start, end]);

  const totalRevenue = (summary?.identified_revenue ?? 0) + (summary?.anonymous_revenue ?? 0);
  const identifiedShare = totalRevenue > 0
    ? ((summary?.identified_revenue ?? 0) / totalRevenue) * 100 : null;
  const totalPrev = (summary?.identified_revenue_prev ?? 0) + (summary?.anonymous_revenue_prev ?? 0);
  const identifiedSharePrev = totalPrev > 0
    ? ((summary?.identified_revenue_prev ?? 0) / totalPrev) * 100 : null;

  const identifiedBasket = summary !== undefined && summary.identified_orders > 0
    ? summary.identified_revenue / summary.identified_orders : null;
  const anonymousBasket = summary !== undefined && summary.anonymous_orders > 0
    ? summary.anonymous_revenue / summary.anonymous_orders : null;

  const churnedValue = churned.reduce((s, c) => s + c.revenue_prev, 0);

  // Pareto et ventilation par type — dérivés des MÊMES lignes que la table.
  const paretoRows = useMemo(
    () => rows.slice(0, MAX_BARS).map((r) => ({ customer: r.name, revenue: r.revenue })),
    [rows],
  );

  const typeRows: BreakdownRow[] = useMemo(() => {
    if (summary === undefined) return [];
    const retail = rows.filter((r) => r.customer_type === 'retail');
    const b2b    = rows.filter((r) => r.customer_type === 'b2b');
    const retailRevenue = retail.reduce((s, r) => s + r.revenue, 0);
    const b2bRevenue    = b2b.reduce((s, r) => s + r.revenue, 0);
    const total = summary.identified_revenue;
    return [
      {
        key: 'retail', label: 'Retail', amount: retailRevenue,
        sharePct: sharePct(retailRevenue, total),
        color: CHART_1, count: `${formatCount(retail.length)} customers`,
      },
      {
        key: 'b2b', label: 'B2B', amount: b2bRevenue,
        sharePct: sharePct(b2bRevenue, total),
        color: CHART_3, count: `${formatCount(b2b.length)} accounts`,
      },
    ];
  }, [rows, summary]);

  const tiles: KpiDescriptor[] = [
    {
      key: 'identified', label: 'Identified revenue',
      value: formatIdrCompact(summary?.identified_revenue ?? 0),
      title: formatIdrFull(summary?.identified_revenue ?? 0),
      delta: pctChange(summary?.identified_revenue ?? 0, summary?.identified_revenue_prev),
      note:  `of ${formatIdrCompact(totalRevenue)} total revenue`,
    },
    {
      key: 'share', label: 'Identified share',
      value: identifiedShare === null ? '—' : formatPct1(identifiedShare),
      note:  identifiedSharePrev === null
        ? 'capture rate of total revenue'
        : `${formatPct1(identifiedSharePrev)} previous period`,
    },
    {
      key: 'customers', label: 'Active customers',
      value: formatCount(summary?.customer_count ?? 0),
      note:  `${formatCount(summary?.new_customer_count ?? 0)} new · ${formatCount((summary?.customer_count ?? 0) - (summary?.new_customer_count ?? 0))} returning`,
    },
    {
      key: 'basket', label: 'Identified vs anonymous basket',
      value: identifiedBasket === null ? '—' : formatIdrCompact(identifiedBasket),
      note:  identifiedBasket !== null && anonymousBasket !== null && anonymousBasket > 0
        ? `vs ${formatIdrCompact(anonymousBasket)} — ×${(identifiedBasket / anonymousBasket).toLocaleString('id-ID', { maximumFractionDigits: 1 })}`
        : 'no anonymous sale to compare',
    },
    {
      key: 'churned', label: 'Churning customers',
      value: formatCount(churned.length),
      note:  churned.length > 0
        ? `${formatIdrCompact(churnedValue)} at risk · none since ${shortDate(report.data?.period_prev.end ?? start)}`
        : 'nobody dropped off',
    },
  ];

  const meta = [
    periodLabel(start, end),
    `${formatCount(rows.length)} customer${rows.length === 1 ? '' : 's'}`,
    'identified sales, vs the previous window of same length',
  ].join(' · ');

  const toolbar = (
    <>
      <PeriodControl period={period} />
      <label className="flex items-center gap-1.5 text-xs text-text-muted">
        <span>Type</span>
        <select
          value={typeFilter}
          onChange={(e) => { setTypeFilter(e.target.value); }}
          aria-label="Customer type filter"
          className={cn(selectClassName, 'h-9 w-auto')}
        >
          <option value="">All types</option>
          <option value="retail">Retail</option>
          <option value="b2b">B2B</option>
        </select>
      </label>
      <ExportMenu
        csv={{ rows, columns: csvColumns, filename: `sales-by-customer-${start}_${end}` }}
        disabled={rows.length === 0}
      />
    </>
  );

  return (
    <ReportShell
      title="Sales by Customer"
      subtitle={meta}
      breadcrumb={[{ label: 'Reports', to: '/backoffice/reports' }, { label: 'Sales' }]}
      toolbar={toolbar}
      error={report.error}
      isEmpty={!report.isLoading && report.data !== undefined
        && rows.length === 0 && churned.length === 0}
      emptyState={{
        title: 'No identified sale',
        description: 'No order carried a customer in the selected date range and type.',
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
              {/* Du CA identifié qui monte est une BONNE nouvelle — pas d'invert,
                  contrairement aux rapports de coût et de sortie d'argent. */}
              {t.delta !== undefined && <Delta value={t.delta} period="prev" onInk={i === 0} />}
              {t.note !== undefined && (
                <span className={i === 0 ? KPI_NOTE_HERO : KPI_NOTE}>{t.note}</span>
              )}
            </KpiTile>
          ))}
        </KpiBand>
      }
    >
      {/* Les réserves conditionnent la lecture de chaque chiffre de l'écran. */}
      <p
        className="rounded-sm border border-border-subtle bg-surface-4 px-3 py-2 text-xs text-text-secondary"
        data-testid="scope-caveat"
      >
        <strong>Identified = a customer attached at checkout.</strong> Anonymous is not
        &laquo;&nbsp;small customers&nbsp;&raquo; — it is walk-in counter revenue: the identified
        share measures <em>capture</em>, not clientele. B2B is counted and badged (its
        outstanding balance lives in the B2B module). The type filter narrows identified figures
        only — anonymous has no type. RFM segments and cohorts live in Marketing.
      </p>

      <div className="mt-3 grid gap-3 xl:grid-cols-[1.7fr_1fr]">
        <PanelCard
          title="Identified vs anonymous revenue, weekly"
          aside={<span className="text-xs text-text-muted">Served daily, folded into weeks</span>}
          isLoading={report.isLoading}
          testId="chart-capture-weekly"
        >
          <StackedBarsChart
            data={weekly}
            xKey="label"
            series={STACK_SERIES}
            ariaLabel={`Identified and anonymous revenue stacked per week from ${start} to ${end}.`}
          />
        </PanelCard>
        <BreakdownCard
          title="Identified revenue by type"
          subtitle="Same rows as the table, split retail vs B2B."
          variant="track"
          rows={typeRows}
          total={{ label: 'Identified revenue', amount: summary?.identified_revenue ?? 0 }}
          isLoading={report.isLoading}
          error={report.error}
          shareBar={{
            title:     'Share of identified revenue',
            ariaLabel: 'Share of identified revenue by customer type',
            segments:  typeRows.map((r): ShareSegment => ({
              label: r.label, pct: r.sharePct ?? 0, color: r.color ?? CHART_1,
            })),
          }}
          shareBarPlacement="after-total"
          emptyText="No identified sale to split for this period."
          testId="breakdown-types"
        />
      </div>

      <div className="mt-3 grid gap-3 xl:grid-cols-[1.7fr_1fr]">
        <PanelCard
          title="Identified revenue concentration"
          aside={rows.length > MAX_BARS ? (
            <span className="text-xs text-text-muted">
              Top {MAX_BARS} of {formatCount(rows.length)}
            </span>
          ) : undefined}
          isLoading={report.isLoading}
          testId="chart-customer-pareto"
        >
          <ParetoChart
            data={paretoRows}
            xKey="customer"
            valueKey="revenue"
            valueName="Revenue"
            grandTotal={summary?.identified_revenue ?? 0}
            xTickFormatter={(v) => truncate(String(v))}
            ariaLabel={`Identified revenue per customer, highest first, with the cumulative revenue over the whole period from ${start} to ${end}.`}
          />
        </PanelCard>
        <PanelCard
          title="Churning customers"
          aside={
            <span className="text-xs text-text-muted">
              {formatCount(churned.length)} customers · {formatIdrCompact(churnedValue)} at risk
            </span>
          }
          isLoading={report.isLoading}
          testId="sbc-churned"
        >
          {churned.length === 0 ? (
            <p className="py-6 text-center text-sm text-text-muted">
              Nobody with repeat purchases dropped off — nothing to win back.
            </p>
          ) : (
            <>
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <caption className="sr-only">
                    Customers with repeat purchases in the previous window and none since
                  </caption>
                  <thead>
                    <tr className="border-b border-border-subtle text-text-secondary">
                      <th scope="col" className="py-2 pr-3 text-left font-normal">Customer</th>
                      <th scope="col" className="py-2 pr-3 text-right font-normal">Prev. revenue</th>
                      <th scope="col" className="py-2 pr-3 text-left font-normal">Last order</th>
                    </tr>
                  </thead>
                  <tbody>
                    {churned.slice(0, CHURN_SHOWN).map((c) => {
                      const url = buildDrilldownUrl('customer', c.customer_id);
                      return (
                        <tr key={c.customer_id} className="border-b border-border-subtle">
                          <td className="py-2">
                            {url !== null ? (
                              <Link
                                to={url}
                                className={cn('text-gold underline-offset-2 hover:underline', FOCUS_RING)}
                              >
                                {c.name}
                              </Link>
                            ) : c.name}
                          </td>
                          <td className={NUM_CELL}>{formatIdrFull(c.revenue_prev)}</td>
                          <td className="py-2 text-text-secondary">{shortDate(c.last_order_date)}</td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
              {churned.length > CHURN_SHOWN && (
                <p className="pt-2 text-xs text-text-muted">
                  {CHURN_SHOWN} of {formatCount(churned.length)} shown, by previous revenue.
                </p>
              )}
            </>
          )}
        </PanelCard>
      </div>

      <PanelCard
        title="Customer detail"
        aside={<span className="text-xs text-text-muted">Customer opens the customer file</span>}
        className="mt-3"
        isLoading={report.isLoading}
        testId="sbc-customer-table"
      >
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <caption className="sr-only">
              Orders, revenue, basket and loyalty per identified customer
            </caption>
            <thead>
              <tr className="border-b border-border-subtle text-text-secondary">
                <SortableTh label="Customer"   sortKey="name"    sorted={sorted} />
                <SortableTh label="Type"       sortKey="type"    sorted={sorted} />
                <SortableTh label="Orders"     sortKey="orders"  sorted={sorted} align="right" />
                <SortableTh label="Revenue"    sortKey="revenue" sorted={sorted} align="right" />
                <SortableTh label="Avg basket" sortKey="basket"  sorted={sorted} align="right" />
                <SortableTh label="Δ vs prev"  sortKey="delta"   sorted={sorted} align="right" />
                <SortableTh label="Last order" sortKey="last"    sorted={sorted} align="right" />
                <SortableTh label="Points"     sortKey="points"  sorted={sorted} align="right" />
              </tr>
            </thead>
            <tbody>
              {sorted.rows.map((r) => {
                const url = buildDrilldownUrl('customer', r.customer_id);
                const basket = r.order_count > 0 ? r.revenue / r.order_count : 0;
                const delta = r.revenue_prev !== null
                  ? pctChange(r.revenue, r.revenue_prev) : null;
                return (
                  <tr key={r.customer_id} className="border-b border-border-subtle">
                    <td className="py-2">
                      <span className="inline-flex items-center gap-1.5">
                        {url !== null ? (
                          <Link
                            to={url}
                            className={cn('text-gold underline-offset-2 hover:underline', FOCUS_RING)}
                          >
                            {r.name}
                          </Link>
                        ) : r.name}
                        {r.is_new && <Badge variant="success">new</Badge>}
                      </span>
                    </td>
                    <td className="py-2">
                      <Badge variant={r.customer_type === 'b2b' ? 'info' : 'neutral'}>
                        {r.customer_type === 'b2b' ? 'B2B' : 'retail'}
                      </Badge>
                    </td>
                    <td className={NUM_CELL}>{formatCount(r.order_count)}</td>
                    <td className={NUM_CELL}>{formatIdrFull(r.revenue)}</td>
                    <td className={NUM_CELL}>{formatIdrFull(basket)}</td>
                    <td className={NUM_CELL}>
                      {r.is_new || delta === null
                        ? <span className="text-text-muted">{r.is_new ? 'new' : '—'}</span>
                        : <Delta value={delta} />}
                    </td>
                    <td className={NUM_CELL}>{shortDate(r.last_order_date)}</td>
                    <td className={NUM_CELL}>
                      {r.customer_type === 'b2b'
                        ? <span className="text-text-subtle">—</span>
                        : formatCount(r.loyalty_points)}
                    </td>
                  </tr>
                );
              })}
            </tbody>
            {sorted.rows.length > 0 && summary !== undefined && (
              <tfoot>
                <tr className="border-t border-border-subtle font-semibold">
                  <td className="py-2">Total</td>
                  <td />
                  <td className={NUM_CELL}>{formatCount(summary.identified_orders)}</td>
                  <td className={NUM_CELL}>{formatIdrFull(summary.identified_revenue)}</td>
                  <td className={NUM_CELL}>
                    {identifiedBasket !== null ? formatIdrFull(identifiedBasket) : '—'}
                  </td>
                  <td colSpan={3} />
                </tr>
              </tfoot>
            )}
          </table>
        </div>
      </PanelCard>
    </ReportShell>
  );
}
