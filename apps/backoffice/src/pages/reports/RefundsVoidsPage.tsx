// apps/backoffice/src/pages/reports/RefundsVoidsPage.tsx
//
// « Refunds & Voids » — l'argent qui ressort. Famille Sales, archétype Report
// (socle Report shell v2) ; patron : SalesByProductPage. Question tranchée :
// « combien d'argent ressort par les annulations, qui le déclenche, sur quoi,
// et pourquoi ? » (conception validée par Mamat le 2026-08-16).
//
// TROIS CHOSES QUE CETTE PAGE DIT ET QU'AUCUNE AUTRE NE DISAIT :
//
//  1. TROIS FLUX, JAMAIS CONFONDUS. Un void rembourse la commande entière ; un
//     remboursement partiel en rend une partie ; une ligne annulée AVANT
//     paiement ne sort aucun argent — elle mesure la friction en caisse et vit
//     dans son propre panneau, jamais additionnée au remboursé.
//  2. CHAQUE SORTIE D'ARGENT EST SIGNÉE DEUX FOIS. Qui l'a saisie, qui l'a
//     autorisée — et par quelle méthode elle est ressortie : le cash remboursé
//     se recompte au tiroir, il porte un badge.
//  3. LA BANDE NE PEUT PAS DIVERGER DE LA TABLE. Les ventilations jour / motif
//     / méthode se recalculent depuis les événements affichés ; seul le CA brut
//     (dénominateur du taux) vient du serveur.
//
// Les filtres type / caissier ne touchent que la TABLE : la bande de KPI et
// les ventilations disent toujours la période entière — un KPI qui suivrait un
// filtre en silence lirait comme un chiffre de période.

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
import { TrendLineChart } from '@/features/reports/components/charts/TrendLineChart.js';
import { useReportPeriod } from '@/features/reports/hooks/useReportPeriod.js';
import { useSortedRows, type SortSpec } from '@/features/reports/hooks/useSortedRows.js';
import {
  useRefundsReport, type RefundEvent, type RefundReasonFamily,
} from '@/features/reports/hooks/useRefundsReport.js';
import { useUrlState } from '@/hooks/useUrlState.js';
import { buildDrilldownUrl } from '@/features/reports/utils/buildDrilldownUrl.js';
import {
  categoricalColor, formatIdrCompact, formatIdrFull,
} from '@/features/reports/utils/chartColors.js';
import {
  eachDay, formatCount, pctChange, periodLabel, shortDate,
} from '@/features/reports/utils/reportFigures.js';

/** Libellés des familles de motif servies par la RPC (raison brute regroupée). */
const FAMILY_LABELS: Record<RefundReasonFamily, string> = {
  input_error:     'Input error',
  quality:         'Quality issue',
  customer_change: 'Customer changed mind',
  duplicate:       'Duplicate payment',
  other:           'Other',
};

function methodLabel(m: string): string {
  if (m === '') return '—';
  if (m.toLowerCase() === 'qris') return 'QRIS';
  return m.charAt(0).toUpperCase() + m.slice(1);
}

/** « 30 Jun 2026, 09:15 » — l'heure de l'événement, en heure métier locale. */
function eventDateTime(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleString('en-GB', {
    day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit',
  });
}

/** « 1,29% » — un taux sous 2 % se joue à la décimale, on en garde deux. */
function fmtPct2(v: number): string {
  return `${v.toLocaleString('id-ID', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}%`;
}

const csvColumns: CsvColumn<RefundEvent>[] = [
  { header: 'Date',          accessor: (r) => r.created_at,                        format: 'text' },
  { header: 'Refund #',      accessor: (r) => r.refund_number,                     format: 'text' },
  { header: 'Order #',       accessor: (r) => r.order_number,                      format: 'text' },
  { header: 'Type',          accessor: (r) => (r.is_full_void ? 'void' : 'partial'), format: 'text' },
  { header: 'Reason',        accessor: (r) => r.reason,                            format: 'text' },
  { header: 'Reason family', accessor: (r) => FAMILY_LABELS[r.reason_family],      format: 'text' },
  { header: 'Methods',       accessor: (r) => r.payments.map((p) => `${p.method} ${String(p.amount)}`).join(' + '), format: 'text' },
  { header: 'Entered by',    accessor: (r) => r.refunded_by.name ?? '',            format: 'text' },
  { header: 'Authorized by', accessor: (r) => r.authorized_by.name ?? '',          format: 'text' },
  { header: 'Tax refunded',  accessor: (r) => r.tax_refunded,                      format: 'idr-round100' },
  { header: 'Amount',        accessor: (r) => r.total,                             format: 'idr-round100' },
];

const NUM_CELL = 'py-2 text-right font-data tabular-nums';

type SortKey = 'date' | 'type' | 'reason' | 'by' | 'amount';

/** Défini au niveau module : une identité neuve à chaque rendu retrierait sans fin. */
const SORT_SPECS: Readonly<Record<SortKey, SortSpec<RefundEvent>>> = {
  date:   { kind: 'string', value: (r) => r.created_at },
  type:   { kind: 'string', value: (r) => (r.is_full_void ? 'void' : 'partial') },
  reason: { kind: 'string', value: (r) => r.reason },
  by:     { kind: 'string', value: (r) => r.refunded_by.name },
  amount: { kind: 'number', value: (r) => r.total },
};

interface KpiDescriptor {
  key: string; label: string; value: string;
  title?: string; delta?: number | null; note?: string;
}

export default function RefundsVoidsPage(): JSX.Element {
  const period = useReportPeriod();
  const { start, end } = period;
  const [typeFilter, setTypeFilter]   = useUrlState('type', '');
  const [staffFilter, setStaffFilter] = useUrlState('staff', '');

  const report = useRefundsReport({ start, end });

  const events  = useMemo(() => report.data?.events ?? [], [report.data]);
  const summary = report.data?.summary;
  const cancelledRows = report.data?.cancelled_by_product ?? [];

  // ── Dérivations pleine période (la bande et les cartes ne suivent PAS les
  //    filtres de table) ──────────────────────────────────────────────────────

  const daily = useMemo(() => {
    const byDate = new Map<string, number>();
    for (const e of events) {
      byDate.set(e.business_date, (byDate.get(e.business_date) ?? 0) + e.total);
    }
    return eachDay(start, end).map((d) => ({
      date: d, label: shortDate(d), amount: byDate.get(d) ?? 0,
    }));
  }, [events, start, end]);

  const reasonRows: BreakdownRow[] = useMemo(() => {
    const byFamily = new Map<RefundReasonFamily, number>();
    for (const e of events) {
      byFamily.set(e.reason_family, (byFamily.get(e.reason_family) ?? 0) + e.total);
    }
    const total = summary?.refunded ?? 0;
    return Array.from(byFamily, ([family, amount]) => ({ family, amount }))
      .sort((a, b) => b.amount - a.amount)
      .map((r, i) => ({
        key:      r.family,
        label:    FAMILY_LABELS[r.family],
        amount:   r.amount,
        sharePct: total > 0 ? (r.amount / total) * 100 : 0,
        color:    categoricalColor(i),
      }));
  }, [events, summary]);

  const methodRows: BreakdownRow[] = useMemo(() => {
    const byMethod = new Map<string, number>();
    for (const e of events) {
      for (const p of e.payments) {
        byMethod.set(p.method, (byMethod.get(p.method) ?? 0) + p.amount);
      }
    }
    const total = Array.from(byMethod.values()).reduce((s, v) => s + v, 0);
    return Array.from(byMethod, ([method, amount]) => ({ method, amount }))
      .sort((a, b) => b.amount - a.amount)
      .map((r, i) => ({
        key:      r.method,
        label:    methodLabel(r.method),
        amount:   r.amount,
        sharePct: total > 0 ? (r.amount / total) * 100 : 0,
        color:    categoricalColor(i),
      }));
  }, [events]);

  const topReason = reasonRows[0];

  // ── Table filtrée (type / caissier) ─────────────────────────────────────────

  const staffOptions = useMemo(() => {
    const seen = new Map<string, string>();
    for (const e of events) {
      if (e.refunded_by.id !== null && e.refunded_by.name !== null) {
        seen.set(e.refunded_by.id, e.refunded_by.name);
      }
    }
    return Array.from(seen, ([id, name]) => ({ id, name }))
      .sort((a, b) => a.name.localeCompare(b.name));
  }, [events]);

  const filtered = useMemo(
    () => events.filter((e) =>
      (typeFilter === '' || (typeFilter === 'void') === e.is_full_void)
      && (staffFilter === '' || e.refunded_by.id === staffFilter)),
    [events, typeFilter, staffFilter],
  );

  const sorted = useSortedRows<RefundEvent, SortKey>(filtered, SORT_SPECS);

  const filteredTotal = filtered.reduce((s, e) => s + e.total, 0);
  const filteredVoids = filtered.filter((e) => e.is_full_void);
  const isFiltered = typeFilter !== '' || staffFilter !== '';

  // ── KPI ─────────────────────────────────────────────────────────────────────

  const rate     = summary !== undefined && summary.gross_sales > 0
    ? (summary.refunded / summary.gross_sales) * 100 : null;
  const ratePrev = summary !== undefined && summary.gross_sales_prev > 0
    ? (summary.refunded_prev / summary.gross_sales_prev) * 100 : null;

  const tiles: KpiDescriptor[] = [
    {
      key: 'refunded', label: 'Money refunded',
      value: formatIdrCompact(summary?.refunded ?? 0), title: formatIdrFull(summary?.refunded ?? 0),
      delta: pctChange(summary?.refunded ?? 0, summary?.refunded_prev),
      note:  'voids included',
    },
    {
      key: 'rate', label: 'Refund rate',
      value: rate === null ? '—' : fmtPct2(rate),
      note:  rate === null
        ? 'no gross sales in this period'
        : `of gross sales · ${ratePrev === null ? 'no' : fmtPct2(ratePrev)} previous period`,
    },
    {
      key: 'voids', label: 'Voids (orders)',
      value: formatCount(summary?.void_count ?? 0),
      note:  `${formatIdrCompact(summary?.void_amount ?? 0)} · full refunds`,
    },
    {
      key: 'cancelled', label: 'Lines cancelled pre-payment',
      value: formatCount(summary?.cancelled.lines ?? 0),
      note:  `${formatIdrCompact(summary?.cancelled.value ?? 0)} avoided · no money out`,
    },
    {
      // Une variation n'a pas de sens sur un NOM : la tuile porte la part.
      key: 'top-reason', label: 'Top reason',
      value: topReason?.label ?? '—',
      note:  topReason !== undefined && (summary?.refunded ?? 0) > 0
        ? `${formatIdrCompact(topReason.amount)} · ${(topReason.sharePct ?? 0).toLocaleString('id-ID', { maximumFractionDigits: 1 })}% of refunded`
        : 'nothing refunded in this period',
    },
  ];

  const meta = [
    periodLabel(start, end),
    `${formatCount(events.length)} event${events.length === 1 ? '' : 's'}`,
    'business days, vs the previous window of same length',
  ].join(' · ');

  const toolbar = (
    <>
      <PeriodControl period={period} />
      <label className="flex items-center gap-1.5 text-xs text-text-muted">
        <span>Type</span>
        <select
          value={typeFilter}
          onChange={(e) => { setTypeFilter(e.target.value); }}
          aria-label="Type filter"
          className={cn(selectClassName, 'h-8 w-auto')}
        >
          <option value="">All types</option>
          <option value="void">Voids</option>
          <option value="partial">Partial refunds</option>
        </select>
      </label>
      <label className="flex items-center gap-1.5 text-xs text-text-muted">
        <span>Cashier</span>
        <select
          value={staffFilter}
          onChange={(e) => { setStaffFilter(e.target.value); }}
          aria-label="Cashier filter"
          className={cn(selectClassName, 'h-8 w-auto')}
        >
          <option value="">All cashiers</option>
          {staffOptions.map((s) => (
            <option key={s.id} value={s.id}>{s.name}</option>
          ))}
        </select>
      </label>
      <ExportMenu
        csv={{ rows: filtered, columns: csvColumns, filename: `refunds-voids-${start}_${end}` }}
        disabled={filtered.length === 0}
      />
    </>
  );

  return (
    <ReportShell
      title="Refunds & Voids"
      subtitle={meta}
      breadcrumb={[{ label: 'Reports', to: '/backoffice/reports' }, { label: 'Sales' }]}
      toolbar={toolbar}
      error={report.error}
      isEmpty={!report.isLoading && report.data !== undefined
        && events.length === 0 && cancelledRows.length === 0}
      emptyState={{
        title: 'Nothing refunded, nothing cancelled',
        description: 'No refund, void or pre-payment cancellation in the selected date range.',
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
              {/* Une HAUSSE est une mauvaise nouvelle sur une sortie d'argent. */}
              {t.delta !== undefined && <Delta value={t.delta} period="prev" invert onInk={i === 0} />}
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
        <strong>Three distinct flows.</strong> A <em>void</em> refunds the whole order; a
        <em> partial refund</em> returns part of its lines; a <em>line cancelled before
        payment</em> takes no money out — it measures counter friction and is never added to
        the refunded amount. Every refund is signed twice: who entered it, who authorized it.
        Refund rate = refunded ÷ gross sales (canonical sales scope). Reasons are free text,
        grouped into families server-side.
      </p>

      <div className="mt-3 grid gap-3 xl:grid-cols-[1.7fr_1fr]">
        <PanelCard
          title="Refunded per day"
          aside={<span className="text-xs text-text-muted">Days without an event are zero</span>}
          isLoading={report.isLoading}
          testId="chart-refunds-daily"
        >
          <TrendLineChart
            data={daily}
            xKey="label"
            currentKey="amount"
            currentName="Refunded"
            dots
            ariaLabel={`Refunded amount per business day from ${start} to ${end}, one dot per day with at least one refund.`}
          />
        </PanelCard>
        <BreakdownCard
          title="By reason"
          subtitle="Free-text reasons, grouped into families."
          variant="track"
          rows={reasonRows}
          total={{ label: 'Total refunded', amount: summary?.refunded ?? 0 }}
          isLoading={report.isLoading}
          error={report.error}
          shareBar={{
            title:     'Share of refunded',
            ariaLabel: 'Share of refunded amount by reason family',
            segments:  reasonRows.map((r): ShareSegment => ({
              label: r.label, pct: r.sharePct ?? 0, color: r.color ?? categoricalColor(0),
            })),
          }}
          shareBarPlacement="after-total"
          emptyText="Nothing refunded in this period."
          testId="breakdown-reasons"
        />
      </div>

      <PanelCard
        title="Refunds & voids"
        aside={
          <span className="text-xs text-text-muted">
            {isFiltered
              ? `Filtered: ${formatCount(filtered.length)} of ${formatCount(events.length)} events`
              : 'Order number opens the order'}
          </span>
        }
        className="mt-3"
        isLoading={report.isLoading}
        testId="rv-events-table"
      >
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <caption className="sr-only">
              Refund events with type, reason, methods, double signature and amount
            </caption>
            <thead>
              <tr className="border-b border-border-subtle text-text-secondary">
                <SortableTh label="Date"    sortKey="date"   sorted={sorted} />
                <th className="py-2 pr-3 text-left font-normal">Refund #</th>
                <th className="py-2 pr-3 text-left font-normal">Order</th>
                <SortableTh label="Type"    sortKey="type"   sorted={sorted} />
                <SortableTh label="Reason"  sortKey="reason" sorted={sorted} />
                <th className="py-2 pr-3 text-left font-normal">Methods</th>
                <SortableTh label="Entered by" sortKey="by"  sorted={sorted} />
                <th className="py-2 pr-3 text-left font-normal">Authorized by</th>
                <SortableTh label="Amount"  sortKey="amount" sorted={sorted} align="right" />
              </tr>
            </thead>
            <tbody>
              {sorted.rows.map((e) => {
                const orderUrl = buildDrilldownUrl('order', e.order_id);
                return (
                  <tr key={e.id} className="border-b border-border-subtle">
                    <td className="py-2 text-text-secondary">{eventDateTime(e.created_at)}</td>
                    <td className="py-2 font-data">{e.refund_number}</td>
                    <td className="py-2">
                      {orderUrl !== null ? (
                        <Link
                          to={orderUrl}
                          className={cn('text-gold underline-offset-2 hover:underline', FOCUS_RING)}
                        >
                          {e.order_number}
                        </Link>
                      ) : e.order_number}
                    </td>
                    <td className="py-2">
                      <Badge variant={e.is_full_void ? 'destructive' : 'info'}>
                        {e.is_full_void ? 'void' : 'partial'}
                      </Badge>
                    </td>
                    <td className="py-2 text-text-secondary" title={FAMILY_LABELS[e.reason_family]}>
                      {e.reason !== '' ? e.reason : '—'}
                    </td>
                    <td className="py-2">
                      <span className="flex flex-wrap gap-1">
                        {e.payments.length === 0
                          ? <span className="text-text-subtle">—</span>
                          : e.payments.map((p) => (
                            // Le cash remboursé se recompte au tiroir : badge warning.
                            <Badge
                              key={`${e.id}-${p.method}`}
                              variant={p.method.toLowerCase() === 'cash' ? 'warning' : 'neutral'}
                              title={formatIdrFull(p.amount)}
                            >
                              {methodLabel(p.method)}
                            </Badge>
                          ))}
                      </span>
                    </td>
                    <td className="py-2 text-text-secondary">{e.refunded_by.name ?? '—'}</td>
                    <td className="py-2 text-text-secondary">{e.authorized_by.name ?? '—'}</td>
                    <td className={NUM_CELL}>{formatIdrFull(e.total)}</td>
                  </tr>
                );
              })}
            </tbody>
            {sorted.rows.length > 0 && (
              <tfoot>
                <tr className="border-t border-border-subtle font-semibold">
                  <td className="py-2">{isFiltered ? 'Filtered total' : 'Total'}</td>
                  <td colSpan={7} className="py-2 text-xs font-normal text-text-muted">
                    {formatCount(filteredVoids.length)} void{filteredVoids.length === 1 ? '' : 's'}
                    {' '}({formatIdrFull(filteredVoids.reduce((s, e) => s + e.total, 0))})
                    {' + '}
                    {formatCount(filtered.length - filteredVoids.length)} partial
                    {' '}({formatIdrFull(filteredTotal - filteredVoids.reduce((s, e) => s + e.total, 0))})
                  </td>
                  <td className={NUM_CELL}>{formatIdrFull(filteredTotal)}</td>
                </tr>
              </tfoot>
            )}
          </table>
        </div>
      </PanelCard>

      <div className="mt-3 grid gap-3 xl:grid-cols-[1fr_1.7fr]">
        <BreakdownCard
          title="Refunded by method"
          subtitle="Cash refunds reconcile against the drawer."
          variant="track"
          rows={methodRows}
          total={{ label: 'Total', amount: methodRows.reduce((s, r) => s + r.amount, 0) }}
          isLoading={report.isLoading}
          error={report.error}
          emptyText="Nothing refunded in this period."
          testId="breakdown-methods"
        />
        <PanelCard
          title="Lines cancelled before payment"
          aside={
            <span className="text-xs text-text-muted">
              {formatCount(summary?.cancelled.lines ?? 0)} lines
              · {formatIdrCompact(summary?.cancelled.value ?? 0)} avoided · no money out
            </span>
          }
          isLoading={report.isLoading}
          testId="rv-cancelled-table"
        >
          {cancelledRows.length === 0 ? (
            <p className="py-6 text-center text-sm text-text-muted">
              No line was cancelled before payment in this period.
            </p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <caption className="sr-only">
                  Cancelled lines per article with dominant reason and most frequent cashier
                </caption>
                <thead>
                  <tr className="border-b border-border-subtle text-text-secondary">
                    <th className="py-2 pr-3 text-left font-normal">Article</th>
                    <th className="py-2 pr-3 text-right font-normal">Lines</th>
                    <th className="py-2 pr-3 text-right font-normal">Value avoided</th>
                    <th className="py-2 pr-3 text-left font-normal">Dominant reason</th>
                    <th className="py-2 pr-3 text-left font-normal">Most frequent cashier</th>
                  </tr>
                </thead>
                <tbody>
                  {cancelledRows.map((r) => (
                    <tr key={r.product_id} className="border-b border-border-subtle">
                      <td className="py-2">{r.name}</td>
                      <td className={NUM_CELL}>{formatCount(r.line_count)}</td>
                      <td className={NUM_CELL}>{formatIdrFull(r.value)}</td>
                      <td className="py-2 text-text-secondary">{r.top_reason ?? '—'}</td>
                      <td className="py-2 text-text-secondary">
                        {r.top_cashier.name !== null
                          ? `${r.top_cashier.name} (${formatCount(r.top_cashier.count)})`
                          : '—'}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </PanelCard>
      </div>
    </ReportShell>
  );
}
