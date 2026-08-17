// apps/backoffice/src/pages/reports/ComboSalesPage.tsx
//
// « Combo Sales » — les combos se vendent-ils. Famille Sales, archétype
// Report (socle Report shell v2) ; patron : DiscountsLoyaltyPage. Question
// tranchée : « mes combos se vendent-ils, lesquels — et tirent-ils le panier
// vers le haut ? » (maquette + arbitrages validés par Mamat le 2026-08-17 :
// prix effectif total seul, cannibalisation en v2).
//
// TROIS CHOSES QUE CETTE PAGE DIT ET QU'AUCUNE AUTRE NE DISAIT :
//
//  1. LE COMBO EST UNE LIGNE, PAS UNE DEVINETTE. combo_components (pricing
//     serveur ADR-017) identifie chaque vente de combo — aucun rapport ne
//     les isolait du reste des ventes.
//  2. L'UPLIFT EST MESURÉ, PAS SUPPOSÉ. Panier moyen des commandes AVEC
//     combo vs SANS — même fenêtre, même périmètre.
//  3. LES CHOIX DE COMPOSANTS PILOTENT LA CARTE. Les picks, pondérés par la
//     quantité de ligne, disent quoi précuire et quoi sortir du groupe.
//
// Frontière : la cannibalisation (composant vendu seul vs en combo) est un
// chantier v2 — arbitrage Mamat.

import { useMemo, type JSX } from 'react';
import { Link } from 'react-router-dom';
import { cn } from '@breakery/ui';
import type { CsvColumn } from '@breakery/domain';
import { PanelCard } from '@/components/PanelCard.js';
import { KpiTile, KPI_NOTE, KPI_NOTE_HERO } from '@/components/kpi/KpiTile.js';
import { Delta } from '@/components/kpi/Delta.js';
import { FOCUS_RING } from '@/components/focusRing.js';
import { ReportShell } from '@/features/reports/components/ReportShell.js';
import { KpiBand } from '@/features/reports/components/KpiBand.js';
import { PeriodControl } from '@/features/reports/components/PeriodControl.js';
import { ExportMenu } from '@/features/reports/components/ExportMenu.js';
import { BreakdownCard, type BreakdownRow } from '@/features/reports/components/BreakdownCard.js';
import { TrendLineChart } from '@/features/reports/components/charts/TrendLineChart.js';
import { useReportPeriod } from '@/features/reports/hooks/useReportPeriod.js';
import { useComboSales, type ComboRow } from '@/features/reports/hooks/useComboSales.js';
import { buildDrilldownUrl } from '@/features/reports/utils/buildDrilldownUrl.js';
import {
  categoricalColor, formatIdrCompact, formatIdrFull,
} from '@/features/reports/utils/chartColors.js';
import {
  eachDay, formatCount, formatPct1, pctChange, periodLabel, shortDate, sharePct,
} from '@/features/reports/utils/reportFigures.js';

const csvColumns: CsvColumn<ComboRow>[] = [
  { header: 'Combo',              accessor: (r) => r.name,      format: 'text' },
  { header: 'Qty',                accessor: (r) => r.qty,       format: 'number' },
  { header: 'Revenue',            accessor: (r) => r.revenue,   format: 'idr-round100' },
  { header: 'Avg effective price', accessor: (r) => r.avg_price, format: 'idr-round100' },
];

const NUM_CELL = 'py-2 text-right font-data tabular-nums';
const PICKS_SHOWN = 8;

export default function ComboSalesPage(): JSX.Element {
  const period = useReportPeriod();
  const { start, end } = period;

  const report = useComboSales({ start, end });
  const summary = report.data?.summary;
  const combos  = report.data?.by_combo ?? [];
  const picks   = report.data?.component_picks ?? [];

  // CA combos par semaine — servi au jour, plié en fenêtres de 7 jours.
  const weekly = useMemo(() => {
    const byDate = new Map((report.data?.by_day ?? []).map((d) => [d.date, d.revenue]));
    const days = eachDay(start, end);
    const out: Record<string, unknown>[] = [];
    for (let i = 0; i < days.length; i += 7) {
      const chunk = days.slice(i, i + 7);
      const first = chunk[0];
      if (first === undefined) break;
      let revenue = 0;
      for (const d of chunk) revenue += byDate.get(d) ?? 0;
      out.push({ label: shortDate(first), revenue });
    }
    return out;
  }, [report.data, start, end]);

  const share = summary !== undefined && summary.gross_sales > 0
    ? (summary.combo_revenue / summary.gross_sales) * 100
    : null;
  const uplift = summary?.avg_ticket_with != null && summary.avg_ticket_without != null
    && summary.avg_ticket_without > 0
    ? ((summary.avg_ticket_with - summary.avg_ticket_without) / summary.avg_ticket_without) * 100
    : null;

  const maxPick = picks[0]?.qty ?? 0;

  const tiles = [
    {
      key: 'revenue', label: 'Combo revenue',
      value: formatIdrCompact(summary?.combo_revenue ?? 0),
      title: formatIdrFull(summary?.combo_revenue ?? 0),
      delta: pctChange(summary?.combo_revenue ?? 0, summary?.combo_revenue_prev ?? 0),
      note:  `${formatCount(summary?.combo_qty ?? 0)} combos in ${formatCount(summary?.combo_orders ?? 0)} orders`,
    },
    {
      key: 'share', label: 'Share of gross sales',
      value: share === null ? '—' : formatPct1(share),
      note:  share === null ? 'no sales in this period' : 'combo lines over all canonical sales',
    },
    {
      key: 'uplift', label: 'Ticket with combo',
      value: summary?.avg_ticket_with != null ? formatIdrCompact(summary.avg_ticket_with) : '—',
      note:  uplift !== null && summary?.avg_ticket_without != null
        ? `vs ${formatIdrCompact(summary.avg_ticket_without)} without (${uplift >= 0 ? '+' : ''}${formatPct1(uplift)})`
        : 'not enough orders to compare',
    },
    {
      key: 'top-combo', label: 'Top combo',
      value: combos[0]?.name ?? '—',
      note:  combos[0] !== undefined
        ? `${formatIdrCompact(combos[0].revenue)} · ${formatCount(combos[0].qty)} sold`
        : 'no combo sold',
    },
  ];

  const meta = [
    periodLabel(start, end),
    'vs the previous window of same length',
  ].join(' · ');

  const toolbar = (
    <>
      <PeriodControl period={period} />
      <ExportMenu
        csv={{ rows: combos, columns: csvColumns, filename: `combo-sales-${start}_${end}` }}
        disabled={combos.length === 0}
      />
    </>
  );

  const isEmpty = !report.isLoading && report.data !== undefined
    && (summary?.combo_qty ?? 0) === 0;

  return (
    <ReportShell
      title="Combo Sales"
      subtitle={meta}
      breadcrumb={[{ label: 'Reports', to: '/backoffice/reports' }, { label: 'Sales' }]}
      toolbar={toolbar}
      error={report.error}
      isEmpty={isEmpty}
      emptyState={{
        title: 'No combo sold',
        description: 'No combo line in the selected date range — combos are configured in Products › Combos.',
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
        <strong>Server-priced combo lines.</strong> A combo sale is an order line carrying
        its chosen components (priced server-side, ADR-017); cancelled lines and promo
        gifts stay out. The effective price is the <em>total</em> paid per combo — base,
        surcharges and modifiers together. Cannibalization (component sold alone vs in a
        combo) is a v2 project.
      </p>

      <div className="mt-3 grid gap-3 xl:grid-cols-[1.7fr_1fr]">
        <PanelCard
          title="Combo revenue per week"
          aside={<span className="text-xs text-text-muted">Served daily, folded into weeks · previous window in the band</span>}
          isLoading={report.isLoading}
          testId="chart-combo-weekly"
        >
          <TrendLineChart
            data={weekly}
            xKey="label"
            currentKey="revenue"
            currentName="Combo revenue"
            ariaLabel={`Combo revenue per week from ${start} to ${end}.`}
          />
        </PanelCard>
        <BreakdownCard
          title="By combo"
          subtitle="Same figures as the band — the sum closes it."
          variant="track"
          rows={combos.map((c, i): BreakdownRow => ({
            key:      c.product_id,
            label:    c.name,
            amount:   c.revenue,
            sharePct: sharePct(c.revenue, summary?.combo_revenue ?? 0),
            color:    categoricalColor(i),
          }))}
          total={{ label: 'Total combo revenue', amount: summary?.combo_revenue ?? 0 }}
          isLoading={report.isLoading}
          error={report.error}
          emptyText="No combo sold in this period."
          testId="breakdown-combos"
        />
      </div>

      <div className="mt-3 grid gap-3 xl:grid-cols-[1.7fr_1fr]">
        <PanelCard
          title="Per combo"
          aside={<span className="text-xs text-text-muted">Effective price = total paid per unit</span>}
          isLoading={report.isLoading}
          testId="combo-table"
        >
          {combos.length === 0 ? (
            <p className="py-6 text-center text-sm text-text-muted">
              No combo sold in this period.
            </p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <caption className="sr-only">
                  Quantity, revenue and average effective price per combo
                </caption>
                <thead>
                  <tr className="border-b border-border-subtle text-text-secondary">
                    <th className="py-2 pr-3 text-left font-normal">Combo</th>
                    <th className="py-2 pr-3 text-right font-normal">Qty</th>
                    <th className="py-2 pr-3 text-right font-normal">Revenue</th>
                    <th className="py-2 pr-3 text-right font-normal">Avg effective price</th>
                  </tr>
                </thead>
                <tbody>
                  {combos.map((c) => {
                    const url = buildDrilldownUrl('product', c.product_id);
                    return (
                      <tr key={c.product_id} className="border-b border-border-subtle">
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
                        <td className={NUM_CELL}>{formatCount(c.qty)}</td>
                        <td className={cn(NUM_CELL, 'font-semibold')}>{formatIdrFull(c.revenue)}</td>
                        <td className={NUM_CELL}>{formatIdrFull(c.avg_price)}</td>
                      </tr>
                    );
                  })}
                </tbody>
                <tfoot>
                  <tr className="border-t border-border-subtle font-semibold">
                    <td className="py-2">Total</td>
                    <td className={NUM_CELL}>{formatCount(summary?.combo_qty ?? 0)}</td>
                    <td className={NUM_CELL}>{formatIdrFull(summary?.combo_revenue ?? 0)}</td>
                    <td className={NUM_CELL} />
                  </tr>
                </tfoot>
              </table>
            </div>
          )}
        </PanelCard>

        <PanelCard
          title="Most-picked components"
          aside={<span className="text-xs text-text-muted">Weighted by line quantity — what to pre-bake</span>}
          isLoading={report.isLoading}
          testId="component-picks"
        >
          {picks.length === 0 ? (
            <p className="py-6 text-center text-sm text-text-muted">
              No component picked in this period.
            </p>
          ) : (
            <ul className="space-y-2">
              {picks.slice(0, PICKS_SHOWN).map((p) => (
                <li key={p.product_id} className="grid grid-cols-[1fr_auto] items-center gap-2">
                  <span className="truncate text-sm">{p.name}</span>
                  <span className="font-data text-sm tabular-nums text-text-secondary">
                    ×{formatCount(p.qty)}
                  </span>
                  <span
                    className="col-span-2 block h-1.5 overflow-hidden rounded-full bg-surface-4"
                    aria-hidden
                  >
                    <span
                      className="block h-full rounded-full"
                      style={{
                        width: `${maxPick > 0 ? (p.qty / maxPick) * 100 : 0}%`,
                        background: categoricalColor(0),
                      }}
                    />
                  </span>
                </li>
              ))}
            </ul>
          )}
        </PanelCard>
      </div>
    </ReportShell>
  );
}
