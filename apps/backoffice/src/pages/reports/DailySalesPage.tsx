// apps/backoffice/src/pages/reports/DailySalesPage.tsx
//
// Lot C (campagne Reports 2026-08-15) — la page FLAGSHIP de l'archétype
// « Report » (maquette 4c), posée sur le socle du lot B (ReportShell, KpiBand,
// PeriodControl, ExportMenu, BreakdownCard, PairedBarsChart) et sur le payload
// `get_daily_sales_v2` (lot I). Quatre propriétés qui ne sont pas cosmétiques :
//
//  1. CHAQUE CHIFFRE PORTE SA COMPARAISON — la période précédente est requêtée
//     en parallèle ; quand la comparaison est impossible la tuile sort un
//     tiret, jamais « 0,0% », qui affirmerait que rien n'a bougé.
//  2. UN SEUL GRAPHE. Le lecteur d'un rapport quotidien cherche la forme de la
//     journée, pas une galerie ; les quatre autres lectures sont chiffrées.
//  3. UNE TRONCATURE D'AFFICHAGE NE TRONQUE PAS LE TOTAL. Les cartes montrent
//     cinq lignes et totalisent le jeu COMPLET (`topSlice`) ; la barre de
//     partage referme ses 100 % par un reliquat « Others ».
//  4. `variance_total` NULL ≠ 0, et `closed_at` seul dit si une caisse est
//     ouverte — des sessions fermées d'avant le comptage ont une variance NULL.
//
// Settings §6.A — jours fériés annotés (badge + colonne CSV) : un jour hors
// tendance doit se lire comme un contexte expliqué.

import { useMemo, type JSX } from 'react';
import { Link } from 'react-router-dom';
import { AlertTriangle, Printer } from 'lucide-react';
import type { CsvColumn } from '@breakery/domain';
import { PanelCard } from '@/components/PanelCard.js';
import { KpiTile, KPI_NOTE, KPI_NOTE_HERO } from '@/components/kpi/KpiTile.js';
import { Delta } from '@/components/kpi/Delta.js';
import { TOOLBAR_BTN_SECONDARY, TOOLBAR_ICON } from '@/components/toolbarButton.js';
import { ReportShell } from '@/features/reports/components/ReportShell.js';
import { KpiBand } from '@/features/reports/components/KpiBand.js';
import { PeriodControl } from '@/features/reports/components/PeriodControl.js';
import { ExportMenu } from '@/features/reports/components/ExportMenu.js';
import {
  BreakdownCard, type BreakdownRow, type ShareSegment,
} from '@/features/reports/components/BreakdownCard.js';
import { PairedBarsChart } from '@/features/reports/components/charts/PairedBarsChart.js';
import { useReportPeriod } from '@/features/reports/hooks/useReportPeriod.js';
import { useDailySales, type DailySalesRow } from '@/features/reports/hooks/useDailySales.js';
import { useSalesByCategory } from '@/features/reports/hooks/useSalesByCategory.js';
import { usePaymentsByMethod } from '@/features/reports/hooks/usePaymentsByMethod.js';
import { useSalesByStaff } from '@/features/reports/hooks/useSalesByStaff.js';
import { useGrossMargin } from '@/features/reports/hooks/useGrossMargin.js';
import { useHolidaysList, holidayNameFor } from '@/features/settings/hooks/useHolidays.js';
import { buildDrilldownUrl } from '@/features/reports/utils/buildDrilldownUrl.js';
import {
  CHART_1, TEXT_INERT, categoricalColor, formatIdrCompact, formatIdrFull,
} from '@/features/reports/utils/chartColors.js';
// Lot F, résiduel de convergence — cette page portait ses propres copies de
// `pctChange`, `sharePct`, `formatCount`, `formatPct1`, `topSlice`, `shortDate`
// et `longDate` : elle est écrite AVANT `reportFigures` (lot D), qui a ensuite
// factorisé les six pages de la vague Sales sans revenir sur le flagship. Le
// comportement est identique — `topSlice` y a les mêmes défauts (5 lignes,
// « by revenue ») et `periodLabel` est exactement la ligne de méta d'ici.
import {
  eachDay, formatCount, formatPct1, pctChange, periodLabel, sharePct, shortDate, topSlice,
} from '@/features/reports/utils/reportFigures.js';

type AnnotatedRow = DailySalesRow & { holiday: string | null };

interface KpiDescriptor {
  key: string; label: string; value: string;
  /** `title` : montant exact, en infobulle quand `value` est compacté.
   *  `invert` : une HAUSSE est une mauvaise nouvelle (remises, remboursements). */
  title?: string; delta: number | null; invert?: boolean; note?: string;
}

const csvColumns: CsvColumn<AnnotatedRow>[] = [
  { header: 'Date',          accessor: (r) => r.date,          format: 'text' },
  { header: 'Holiday',       accessor: (r) => r.holiday ?? '', format: 'text' },
  { header: 'Orders',        accessor: (r) => r.order_count,   format: 'number' },
  { header: 'Gross (IDR)',   accessor: (r) => r.gross,         format: 'idr-round100' },
  { header: 'Refunds (IDR)', accessor: (r) => r.refunds,       format: 'idr-round100' },
  { header: 'Net (IDR)',     accessor: (r) => r.net,           format: 'idr-round100' },
  { header: 'AOV (IDR)',     accessor: (r) => r.aov,           format: 'idr-round100' },
];

const NUM_CELL = 'py-2 text-right font-data tabular-nums';
const INK_LINK = 'text-gold underline-offset-2 hover:underline focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-gold';
/** Sessions de caisse listées dans la carte « Register close ». */
const MAX_SESSIONS = 8;

function capitalize(s: string): string {
  return s.length === 0 ? s : s[0]!.toUpperCase() + s.slice(1);
}

/** Valeur compacte + montant exact, la paire qu'attend `KpiTile`. */
function idr(v: number | undefined): { value: string; title: string } {
  return { value: formatIdrCompact(v ?? 0), title: formatIdrFull(v ?? 0) };
}

export default function DailySalesPage(): JSX.Element {
  const period = useReportPeriod();
  const { start, end, compareRange } = period;

  // Deux appels : la période courante ET la précédente. La bande KPI promet une
  // comparaison sur chaque tuile — sans la seconde requête, elle est décorative.
  const daily   = useDailySales({ start, end });
  const compare = useDailySales({ start: compareRange.start, end: compareRange.end });

  const categories = useSalesByCategory(start, end);
  const payments   = usePaymentsByMethod({ start, end });
  const staff      = useSalesByStaff(start, end);
  const margin     = useGrossMargin({ start, end });
  const holidays   = useHolidaysList();

  const summary  = daily.data?.summary;
  const prev     = compare.data?.summary;
  const sessions = daily.data?.sessions ?? [];

  const byDay = useMemo<AnnotatedRow[]>(
    () => (daily.data?.by_day ?? []).map((r) => ({
      ...r,
      holiday: holidayNameFor(holidays.data, r.date),
    })),
    [daily.data?.by_day, holidays.data],
  );

  // Le graphe se lit jour par jour : une journée sans vente n'a pas de ligne
  // `by_day` et doit tout de même occuper sa barre, sinon la forme de la semaine
  // est fausse. La comparaison s'aligne par RANG dans sa propre fenêtre.
  const chartData = useMemo(() => {
    const cmpDays = eachDay(compareRange.start, compareRange.end);
    const curMap  = new Map((daily.data?.by_day ?? []).map((r) => [r.date, r.net]));
    const cmpMap  = new Map((compare.data?.by_day ?? []).map((r) => [r.date, r.net]));
    return eachDay(start, end).map((d, i) => ({
      date:    d,
      current: curMap.get(d) ?? 0,
      compare: cmpMap.get(cmpDays[i] ?? '') ?? 0,
    }));
  }, [start, end, compareRange.start, compareRange.end, daily.data?.by_day, compare.data?.by_day]);

  const peak = byDay.reduce<AnnotatedRow | null>((b, r) => (b === null || r.net > b.net ? r : b), null);

  const cat  = topSlice((categories.data ?? []).slice().sort((a, b) => b.total - a.total), (c) => c.total);
  const prod = topSlice((margin.data?.by_product ?? []).slice().sort((a, b) => b.revenue - a.revenue), (p) => p.revenue);
  const cash = topSlice((staff.data ?? []).slice().sort((a, b) => b.total - a.total), (s) => s.total);

  const categoryRows: BreakdownRow[] = cat.rows.map((c, i) => {
    const url = buildDrilldownUrl('category', c.category_id, { date_from: start, date_to: end });
    return {
      key: c.category_id, label: c.category_name, amount: c.total,
      sharePct: sharePct(c.total, cat.total), color: categoricalColor(i),
      ...(url !== null ? { to: url } : {}),
    };
  });

  // Écart maquette assumé : la maquette segmente « By order type », qu'AUCUN
  // hook n'expose — la barre segmente donc les mêmes catégories. Le reliquat du
  // jeu complet est agrégé en « Others » : sans lui, cinq segments sur une base
  // entière laisseraient un vide qui se lit comme une part manquante.
  const shownShare = categoryRows.reduce((s, r) => s + (r.sharePct ?? 0), 0);
  const categorySegments: ShareSegment[] = [
    ...categoryRows.map((r) => ({ label: r.label, pct: r.sharePct ?? 0, color: r.color ?? CHART_1 })),
    ...(shownShare < 99.95 ? [{ label: 'Others', pct: 100 - shownShare, color: TEXT_INERT }] : []),
  ];

  const topProducts: BreakdownRow[] = prod.rows.map((p) => {
    const url = buildDrilldownUrl('product', p.product_id);
    return {
      key: p.product_id, label: p.name, amount: p.revenue, count: `×${formatCount(p.qty)}`,
      ...(url !== null ? { to: url } : {}),
    };
  });

  const paymentRows: BreakdownRow[] = (payments.data?.lines ?? []).map((l) => {
    const url = buildDrilldownUrl('order_list', '', { payment_method: l.method, start, end });
    return {
      key: l.method, label: capitalize(l.method), amount: l.amount, sharePct: l.share_pct,
      ...(url !== null ? { to: url } : {}),
    };
  });

  const cashierRows: BreakdownRow[] = cash.rows.map((s) => {
    const url = buildDrilldownUrl('order_list', '', { served_by: s.staff_id, start, end });
    return {
      key: s.staff_id, label: s.staff_name, amount: s.total,
      count: `${formatCount(s.order_count)} orders`,
      ...(url !== null ? { to: url } : {}),
    };
  });

  // `closed_at === null` et non `status === 'open'` : les libellés de statut
  // viennent de Postgres, un littéral TS recopié ici serait la classe de bug
  // `take_away` / `take_out`. La carte ne liste que les sessions les plus
  // RÉCENTES (la RPC ordonne par `opened_at` croissant) : une fenêtre de 28 j en
  // porte des dizaines, qui feraient exploser la rangée à quatre colonnes.
  const openSessions = sessions.filter((s) => s.closed_at === null);
  const sessionRows: BreakdownRow[] = sessions.slice(-MAX_SESSIONS).map((s) => ({
    key:    s.id,
    label:  s.cashier ?? 'Unassigned register',
    amount: s.opening_cash,
    // « not closed yet » suit `closed_at`, PAS la nullité de la variance : des
    // sessions fermées d'avant le comptage ont une variance NULL, et les dire
    // ouvertes serait faux. Variance inconnue → tiret, jamais zéro.
    count:  s.closed_at === null
      ? `${s.status} · not closed yet`
      : `${s.status} · var ${s.variance_total === null ? '—' : formatIdrFull(s.variance_total)}`,
  }));

  const refundsVoids     = (summary?.refund_total ?? 0) + (summary?.voids_value ?? 0);
  const prevRefundsVoids = prev !== undefined ? prev.refund_total + prev.voids_value : undefined;
  const discountNote     = `${formatPct1(sharePct(summary?.discount_total ?? 0, summary?.total ?? 0))}`
    + ` of gross · ${formatCount(summary?.discount_orders_count ?? 0)} tickets`;

  // La bande de la maquette 4c : six tuiles, la première en encre, chacune avec
  // sa variation contre la période précédente.
  const tiles: KpiDescriptor[] = [
    { key: 'net-revenue', label: 'Net revenue', ...idr(summary?.net),
      delta: pctChange(summary?.net ?? 0, prev?.net) },
    { key: 'gross-revenue', label: 'Gross revenue', ...idr(summary?.total),
      delta: pctChange(summary?.total ?? 0, prev?.total) },
    { key: 'refunds-voids', label: 'Refunds & voids', ...idr(refundsVoids),
      delta: pctChange(refundsVoids, prevRefundsVoids), invert: true,
      note: `${formatCount(summary?.voids_count ?? 0)} voids` },
    { key: 'orders', label: 'Orders', value: formatCount(summary?.order_count ?? 0),
      delta: pctChange(summary?.order_count ?? 0, prev?.order_count) },
    { key: 'avg-basket', label: 'Avg basket', ...idr(summary?.aov),
      delta: pctChange(summary?.aov ?? 0, prev?.aov) },
    { key: 'discounts', label: 'Discounts', ...idr(summary?.discount_total),
      delta: pctChange(summary?.discount_total ?? 0, prev?.discount_total), invert: true,
      note: discountNote },
  ];

  const meta = [
    periodLabel(start, end),
    daily.data !== undefined
      ? `${formatCount(sessions.length)} register session${sessions.length === 1 ? '' : 's'}`
      : null,
    'figures net of refunds',
  ].filter((s): s is string => s !== null).join(' · ');

  const showCompareSeries = period.compare && compare.data !== undefined;

  const toolbar = (
    <>
      <PeriodControl period={period} showCompare />
      <button
        type="button" className={TOOLBAR_BTN_SECONDARY} data-testid="print-report"
        onClick={() => { window.print(); }}
      >
        <Printer className={TOOLBAR_ICON} aria-hidden />
        Print
      </button>
      {/* Pas de PDF au lot C : aucun gabarit `daily-sales` n'est enregistré dans
          l'EF `generate-pdf`, et un item qui échoue vaut moins qu'une absence. */}
      <ExportMenu
        csv={{ rows: byDay, columns: csvColumns, filename: `daily-sales-${start}_${end}` }}
        disabled={byDay.length === 0}
      />
    </>
  );

  return (
    <ReportShell
      title="Daily sales"
      subtitle={meta}
      breadcrumb={[{ label: 'Reports', to: '/backoffice/reports' }, { label: 'Sales' }]}
      toolbar={toolbar}
      error={daily.error}
      isEmpty={!daily.isLoading && daily.data !== undefined && byDay.length === 0}
      emptyState={{ title: 'No sales', description: 'No sales for this period.' }}
      kpis={
        // Pas de prop `error` : ReportShell ne rend pas les KPI quand la requête
        // principale a échoué, la branche « unavailable » serait morte ici.
        <KpiBand isLoading={daily.isLoading} labels={tiles.map((t) => t.label)}>
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
          title="Net revenue by day"
          aside={peak !== null ? (
            <span className="text-xs text-text-muted">
              Peak <span className="font-data tabular-nums">{shortDate(peak.date)}</span>
              {' · '}
              <span className="font-data tabular-nums">{formatIdrCompact(peak.net)}</span>
            </span>
          ) : undefined}
          isLoading={daily.isLoading}
          testId="chart-net-by-day"
        >
          <PairedBarsChart
            data={chartData}
            xKey="date"
            currentKey="current"
            currentName="This period"
            {...(showCompareSeries ? { compareKey: 'compare', compareName: 'Previous period' } : {})}
            xTickFormatter={(v) => shortDate(String(v))}
            ariaLabel="Net revenue per day, current period compared with the previous one"
          />
        </PanelCard>
        <BreakdownCard
          title="Revenue by category"
          subtitle={cat.note}
          variant="track"
          rows={categoryRows}
          total={{ label: 'Total', amount: cat.total }}
          isLoading={categories.isLoading}
          error={categories.error}
          shareBar={{
            title: 'Category share',
            ariaLabel: 'Share of revenue by category',
            segments: categorySegments,
          }}
          shareBarPlacement="after-total"
          testId="breakdown-categories"
        />
      </div>

      <div className="mt-3 grid gap-3 md:grid-cols-2 xl:grid-cols-4">
        <BreakdownCard
          title="Top products"
          subtitle={prod.note ?? 'Revenue over the period.'}
          rows={topProducts}
          total={{ label: 'Total', amount: prod.total }}
          isLoading={margin.isLoading}
          error={margin.error}
          testId="breakdown-products"
        />
        <BreakdownCard
          title="Payments"
          rows={paymentRows}
          total={{ label: 'Total collected', amount: payments.data?.total ?? 0 }}
          isLoading={payments.isLoading}
          error={payments.error}
          footer={
            <span className="text-text-muted">
              <span className="font-data tabular-nums">{formatCount(payments.data?.totalCount ?? 0)}</span> payments across{' '}
              <span className="font-data tabular-nums">{formatCount(payments.data?.totalOrders ?? 0)}</span> orders
            </span>
          }
          testId="breakdown-payments"
        />
        <BreakdownCard
          title="By cashier"
          subtitle={cash.note}
          rows={cashierRows}
          total={{ label: 'Total', amount: cash.total }}
          isLoading={staff.isLoading}
          error={staff.error}
          footer={
            // Écart maquette : « Voids by cashier » n'existe dans aucun hook —
            // le total de la période est le fait disponible, on ne l'attribue pas.
            <span className="text-text-muted">
              <span className="font-data tabular-nums">{formatCount(summary?.voids_count ?? 0)}</span> voids ·{' '}
              <span className="font-data tabular-nums">{formatIdrFull(summary?.voids_value ?? 0)}</span> over the period
            </span>
          }
          testId="breakdown-cashiers"
        />
        <BreakdownCard
          title="Register close"
          subtitle={sessions.length > MAX_SESSIONS
            ? `Last ${MAX_SESSIONS} of ${formatCount(sessions.length)} sessions.`
            : undefined}
          rows={sessionRows}
          total={{ label: 'Opening float', amount: sessions.reduce((s, x) => s + x.opening_cash, 0) }}
          isLoading={daily.isLoading}
          emptyText="No register session in this period."
          footer={openSessions.length > 0 ? (
            <>
              <AlertTriangle className="h-3.5 w-3.5 shrink-0 text-danger" aria-hidden />
              <span className="text-text-primary">
                <span className="font-data tabular-nums">{formatCount(openSessions.length)}</span> register
                {openSessions.length === 1 ? '' : 's'} not reconciled
              </span>
              <Link to="/backoffice/cash-register/zreports" className={`ml-auto shrink-0 font-medium ${INK_LINK}`}>
                Open Z-report
              </Link>
            </>
          ) : (
            <span className="text-text-muted">All sessions of this period are closed.</span>
          )}
          testId="breakdown-registers"
        />
      </div>

      {/* La maquette 4c n'a pas de table journalière. Elle est conservée SOUS les
          ventilations comme bloc de détail : elle porte l'annotation des jours
          fériés et le drill-down par jour, deux acquis qu'aucune carte ne rend. */}
      <PanelCard title="Day by day" className="mt-3" isLoading={daily.isLoading} testId="daily-sales-table">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <caption className="sr-only">Gross, refunds, net and average order value per day</caption>
            <thead>
              <tr className="border-b border-border-subtle text-text-secondary">
                <th scope="col" className="py-2 text-left">Date</th>
                {['Orders', 'Gross', 'Refunds', 'Net', 'AOV'].map((h) => (
                  <th key={h} scope="col" className="py-2 text-right">{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {byDay.map((r) => {
                const url = buildDrilldownUrl('order_list', '', { start: r.date, end: r.date });
                return (
                  <tr key={r.date} className="border-b border-border-subtle">
                    <td className="py-2 font-data font-medium tabular-nums">
                      {url !== null ? <Link to={url} className={INK_LINK}>{r.date}</Link> : r.date}
                      {r.holiday !== null && (
                        <span
                          title={r.holiday}
                          data-testid={`holiday-badge-${r.date}`}
                          /* Aplat retiré (The Ink-Not-Gold Rule) et liseré monté
                             de `border-border-gold` (1,64:1, invisible au sens
                             de WCAG 1.4.11) à `border-gold`. */
                          className="ml-2 inline-flex items-center rounded-sm border border-gold px-2 py-0.5 text-xs text-gold"
                        >
                          {r.holiday}
                        </span>
                      )}
                    </td>
                    {[
                      formatCount(r.order_count), formatIdrFull(r.gross), formatIdrFull(r.refunds),
                      formatIdrFull(r.net), formatIdrFull(r.aov),
                    ].map((v, i) => <td key={i} className={NUM_CELL}>{v}</td>)}
                  </tr>
                );
              })}
            </tbody>
            {byDay.length > 0 && summary !== undefined && (
              <tfoot>
                <tr className="border-t border-border-subtle font-semibold">
                  <td className="py-2">Total</td>
                  {[
                    formatCount(summary.order_count), formatIdrFull(summary.total),
                    formatIdrFull(summary.refund_total), formatIdrFull(summary.net),
                    formatIdrFull(summary.aov),
                  ].map((v, i) => <td key={i} className={NUM_CELL}>{v}</td>)}
                </tr>
              </tfoot>
            )}
          </table>
        </div>
      </PanelCard>
    </ReportShell>
  );
}
