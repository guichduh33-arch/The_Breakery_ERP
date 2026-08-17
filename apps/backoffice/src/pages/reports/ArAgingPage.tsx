// apps/backoffice/src/pages/reports/ArAgingPage.tsx
//
// « AR Aging — B2B receivables » — l'argent dehors. Famille Finance, archétype
// Report (socle Report shell v2) ; patron : DiscountsLoyaltyPage. Question
// tranchée : « qui me doit quoi, depuis combien de temps — et qui relancer
// aujourd'hui ? » (maquette + arbitrages validés par Mamat le 2026-08-17 :
// terms défaut 30 j, buckets par jours de RETARD, DSO 90 j en v1).
//
// TROIS CHOSES QUE CETTE PAGE DIT ET QU'AUCUNE AUTRE NE DISAIT :
//
//  1. LE RETARD, PAS L'ÂGE. view_ar_aging (module B2B) bucke depuis l'émission ;
//     ici l'échéance = émission + terms DU CLIENT (défaut 30 j) — un client à
//     45 j négociés n'est pas « en retard » au jour 40.
//  2. L'ENCOURS AU GRAIN FACTURE. total − Σ allocations : une facture
//     partiellement réglée montre ce qui RESTE, pas son montant d'origine.
//  3. LA RÉCONCILIATION EST VISIBLE. L'encours recalculé s'affiche À CÔTÉ du
//     solde caché (b2b_current_balance, la source de vérité du système) — un
//     drift sort en badge au lieu d'être masqué.
//
// SNAPSHOT COURANT : pas de sélecteur de période — le statut live fait foi. Un
// as-of historique serait inexact (une facture payée comptant, sans allocation,
// serait indistinguable d'une créance recouvrée).

import { useMemo, type JSX } from 'react';
import { Link } from 'react-router-dom';
import { cn } from '@breakery/ui';
import type { CsvColumn } from '@breakery/domain';
import { PanelCard } from '@/components/PanelCard.js';
import { KpiTile, KPI_NOTE, KPI_NOTE_HERO } from '@/components/kpi/KpiTile.js';
import { FOCUS_RING } from '@/components/focusRing.js';
import { ReportShell } from '@/features/reports/components/ReportShell.js';
import { KpiBand } from '@/features/reports/components/KpiBand.js';
import { ExportMenu } from '@/features/reports/components/ExportMenu.js';
import {
  BreakdownCard, type BreakdownRow, type ShareSegment,
} from '@/features/reports/components/BreakdownCard.js';
import {
  StackedBarsChart, type StackedSeries,
} from '@/features/reports/components/charts/StackedBarsChart.js';
import {
  useArAging, type ArAgingInvoiceRow, type ArBucket,
} from '@/features/reports/hooks/useArAging.js';
import { buildDrilldownUrl } from '@/features/reports/utils/buildDrilldownUrl.js';
import {
  CHART_1, CHART_2, CHART_3, CHART_4, TEXT_INERT,
  formatIdrCompact, formatIdrFull,
} from '@/features/reports/utils/chartColors.js';
import {
  formatCount, formatPct1, shortDate, sharePct,
} from '@/features/reports/utils/reportFigures.js';

/** Ordre d'IDENTITÉ des buckets — du non-échu au plus grave. Le « courant »
 *  est NEUTRE (inerte) : pas encore une dette en souffrance ; l'intensité
 *  bleue croît avec le retard — la rampe séquentielle, jamais du rouge de
 *  série (le vocabulaire d'état reste aux badges). */
const BUCKETS: { key: ArBucket; label: string; color: string }[] = [
  { key: 'current',      label: 'Current (not due)', color: TEXT_INERT },
  { key: 'late_1_30',    label: '1-30 d late',       color: CHART_4 },
  { key: 'late_31_60',   label: '31-60 d late',      color: CHART_3 },
  { key: 'late_61_90',   label: '61-90 d late',      color: CHART_2 },
  { key: 'late_90_plus', label: '90+ d late',        color: CHART_1 },
];

const STACK_SERIES: StackedSeries[] = BUCKETS.map((b) => ({
  key: b.key, name: b.label, color: b.color,
}));

const csvColumns: CsvColumn<ArAgingInvoiceRow>[] = [
  { header: 'Customer',    accessor: (r) => r.customer_name,             format: 'text' },
  { header: 'Invoice',     accessor: (r) => r.invoice_number ?? r.order_number, format: 'text' },
  { header: 'Issued',      accessor: (r) => r.issued_on,                 format: 'text' },
  { header: 'Due',         accessor: (r) => r.due_date,                  format: 'text' },
  { header: 'Days late',   accessor: (r) => r.days_late,                 format: 'number' },
  { header: 'Total',       accessor: (r) => r.total,                     format: 'idr-round100' },
  { header: 'Settled',     accessor: (r) => r.settled,                   format: 'idr-round100' },
  { header: 'Outstanding', accessor: (r) => r.outstanding,               format: 'idr-round100' },
];

const NUM_CELL = 'py-2 text-right font-data tabular-nums';
/** Lignes visibles de la table factures — la liste entière part au CSV. */
const INVOICES_SHOWN = 10;
/** Au-delà d'1 Rp d'écart, le cache et le recalcul divergent vraiment. */
const DRIFT_TOLERANCE = 1;
/** Clients affichés dans l'exposition empilée. */
const CHART_CUSTOMERS = 8;

function LatePill({ daysLate }: { daysLate: number }): JSX.Element {
  if (daysLate <= 0) {
    return <span className="text-xs text-text-muted">current</span>;
  }
  const grave = daysLate > 60;
  return (
    <span className={cn('text-xs font-semibold', grave ? 'text-danger' : 'text-warning')}>
      {daysLate} d late
    </span>
  );
}

export default function ArAgingPage(): JSX.Element {
  const report = useArAging();
  const summary   = report.data?.summary;
  const invoices  = report.data?.invoices ?? [];
  const customers = report.data?.by_customer ?? [];
  const asOf      = report.data?.as_of;

  const bucketRows: BreakdownRow[] = useMemo(() => {
    const byKey = new Map((report.data?.by_bucket ?? []).map((b) => [b.bucket, b]));
    const total = summary?.total_outstanding ?? 0;
    return BUCKETS.map((b) => {
      const src = byKey.get(b.key);
      return {
        key:      b.key,
        label:    b.label,
        amount:   src?.amount ?? 0,
        sharePct: sharePct(src?.amount ?? 0, total),
        color:    b.color,
      };
    });
  }, [report.data, summary]);

  // Top clients, piles par bucket — l'identité des couleurs suit le bucket.
  const customerBars = useMemo(
    () => customers.slice(0, CHART_CUSTOMERS).map((c) => ({
      name:         c.company ?? c.customer_name,
      current:      c.current,
      late_1_30:    c.late_1_30,
      late_31_60:   c.late_31_60,
      late_61_90:   c.late_61_90,
      late_90_plus: c.late_90_plus,
    })),
    [customers],
  );

  const overduePct = summary !== undefined && summary.total_outstanding > 0
    ? (summary.overdue_total / summary.total_outstanding) * 100
    : null;
  const overLimit = customers.filter(
    (c) => c.credit_limit !== null && c.balance_cached > c.credit_limit,
  ).length;

  const tiles = [
    {
      key: 'outstanding', label: 'Outstanding AR',
      value: formatIdrCompact(summary?.total_outstanding ?? 0),
      title: formatIdrFull(summary?.total_outstanding ?? 0),
      note:  `snapshot as of ${asOf !== undefined && asOf !== '' ? shortDate(asOf) : '—'} · ${formatCount(summary?.invoice_count ?? 0)} open invoices`,
    },
    {
      key: 'overdue', label: 'Overdue',
      value: formatIdrCompact(summary?.overdue_total ?? 0),
      title: formatIdrFull(summary?.overdue_total ?? 0),
      note:  overduePct === null
        ? 'nothing outstanding'
        : `${formatPct1(overduePct)} of outstanding · ${formatCount(summary?.overdue_invoice_count ?? 0)} invoices`,
    },
    {
      key: 'oldest', label: 'Oldest lateness',
      value: (summary?.oldest_days_late ?? 0) > 0 ? `${summary?.oldest_days_late} d` : '—',
      note:  summary?.oldest_customer ?? 'no open invoice',
    },
    {
      key: 'dso', label: 'DSO (90 d)',
      value: summary?.dso_90d != null ? `${summary.dso_90d} d` : '—',
      note:  summary?.dso_90d != null
        ? 'weighted by settled amount'
        : 'no settlement in the last 90 days',
    },
    {
      key: 'exposed', label: 'Customers exposed',
      value: formatCount(summary?.customer_count ?? 0),
      note:  overLimit > 0
        ? `${formatCount(overLimit)} over their credit limit`
        : 'none over their credit limit',
    },
  ];

  const toolbar = (
    <ExportMenu
      csv={{ rows: invoices, columns: csvColumns, filename: `ar-aging-${asOf ?? 'snapshot'}` }}
      disabled={invoices.length === 0}
    />
  );

  const isEmpty = !report.isLoading && report.data !== undefined
    && (summary?.invoice_count ?? 0) === 0;

  return (
    <ReportShell
      title="AR Aging — B2B receivables"
      subtitle="Live snapshot · lateness measured after each customer's payment terms (30 d default)"
      breadcrumb={[{ label: 'Reports', to: '/backoffice/reports' }, { label: 'Finance' }]}
      toolbar={toolbar}
      error={report.error}
      isEmpty={isEmpty}
      emptyState={{
        title: 'No money outstanding',
        description: 'Every B2B invoice is settled — nothing to chase.',
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
              {/* Snapshot instantané : pas de période de comparaison, la note
                  porte la date — jamais un Delta inventé. */}
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
        <strong>Live snapshot, invoice grain.</strong> A receivable is an invoice still
        b2b_pending; its outstanding is the total minus what payments already covered
        (FIFO allocations). Due date = issue date + the customer's payment terms
        (30 d when unset). Buckets count days <em>past due</em>, not invoice age.
        The recalculated exposure is shown next to the system's cached balance —
        a mismatch shows up as a badge, never silently.
      </p>

      <div className="mt-3 grid gap-3 xl:grid-cols-[1.7fr_1fr]">
        <PanelCard
          title="Exposure per customer, by lateness"
          aside={
            <span className="text-xs text-text-muted">
              Top {Math.min(CHART_CUSTOMERS, customers.length)} of {formatCount(customers.length)}, by outstanding
            </span>
          }
          isLoading={report.isLoading}
          testId="chart-ar-customers"
        >
          <StackedBarsChart
            data={customerBars}
            xKey="name"
            series={STACK_SERIES}
            layout="horizontal-bars"
            ariaLabel="Outstanding receivables per customer, stacked by lateness bucket."
          />
        </PanelCard>
        <BreakdownCard
          title="By lateness"
          subtitle="Same figures as the band — the sum closes it."
          variant="track"
          rows={bucketRows}
          total={{ label: 'Total outstanding', amount: summary?.total_outstanding ?? 0 }}
          isLoading={report.isLoading}
          error={report.error}
          shareBar={{
            title:     'Share of outstanding',
            ariaLabel: 'Share of outstanding receivables by lateness bucket',
            segments:  bucketRows.map((r): ShareSegment => ({
              label: r.label, pct: r.sharePct ?? 0, color: r.color ?? TEXT_INERT,
            })),
          }}
          shareBarPlacement="after-total"
          emptyText="Nothing outstanding."
          testId="breakdown-buckets"
        />
      </div>

      <PanelCard
        title="Open invoices"
        aside={
          <span className="text-xs text-text-muted">
            {formatCount(invoices.length)} invoices · oldest first
          </span>
        }
        className="mt-3"
        isLoading={report.isLoading}
        testId="ar-invoices-table"
      >
        {invoices.length === 0 ? (
          <p className="py-6 text-center text-sm text-text-muted">
            No open B2B invoice.
          </p>
        ) : (
          <>
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <caption className="sr-only">
                  Open B2B invoices with due date, lateness and outstanding amount
                </caption>
                <thead>
                  <tr className="border-b border-border-subtle text-text-secondary">
                    <th className="py-2 pr-3 text-left font-normal">Customer</th>
                    <th className="py-2 pr-3 text-left font-normal">Invoice</th>
                    <th className="py-2 pr-3 text-left font-normal">Issued</th>
                    <th className="py-2 pr-3 text-left font-normal">Due</th>
                    <th className="py-2 pr-3 text-left font-normal">Lateness</th>
                    <th className="py-2 pr-3 text-right font-normal">Total</th>
                    <th className="py-2 pr-3 text-right font-normal">Settled</th>
                    <th className="py-2 pr-3 text-right font-normal">Outstanding</th>
                  </tr>
                </thead>
                <tbody>
                  {invoices.slice(0, INVOICES_SHOWN).map((inv) => {
                    const url = buildDrilldownUrl('order', inv.invoice_id);
                    return (
                      <tr key={inv.invoice_id} className="border-b border-border-subtle">
                        <td className="py-2">{inv.customer_name}</td>
                        <td className="py-2">
                          {url !== null ? (
                            <Link
                              to={url}
                              className={cn('text-gold underline-offset-2 hover:underline', FOCUS_RING)}
                            >
                              {inv.invoice_number ?? inv.order_number}
                            </Link>
                          ) : (inv.invoice_number ?? inv.order_number)}
                        </td>
                        <td className="py-2 text-text-secondary">{shortDate(inv.issued_on)}</td>
                        <td className="py-2 text-text-secondary">{shortDate(inv.due_date)}</td>
                        <td className="py-2"><LatePill daysLate={inv.days_late} /></td>
                        <td className={NUM_CELL}>{formatIdrFull(inv.total)}</td>
                        <td className={NUM_CELL}>{formatIdrFull(inv.settled)}</td>
                        <td className={cn(NUM_CELL, 'font-semibold')}>{formatIdrFull(inv.outstanding)}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
            {invoices.length > INVOICES_SHOWN && (
              <p className="pt-2 text-xs text-text-muted">
                {INVOICES_SHOWN} of {formatCount(invoices.length)} shown, oldest first —
                the CSV export carries them all.
              </p>
            )}
          </>
        )}
      </PanelCard>

      <PanelCard
        title="Per customer"
        aside={<span className="text-xs text-text-muted">Recalculated exposure vs the system's cached balance</span>}
        className="mt-3"
        isLoading={report.isLoading}
        testId="ar-customers-table"
      >
        {customers.length === 0 ? (
          <p className="py-6 text-center text-sm text-text-muted">
            No customer with outstanding receivables.
          </p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <caption className="sr-only">
                Outstanding receivables per customer with terms, credit limit and cache reconciliation
              </caption>
              <thead>
                <tr className="border-b border-border-subtle text-text-secondary">
                  <th className="py-2 pr-3 text-left font-normal">Customer</th>
                  <th className="py-2 pr-3 text-right font-normal">Terms</th>
                  <th className="py-2 pr-3 text-right font-normal">Credit limit</th>
                  <th className="py-2 pr-3 text-right font-normal">Outstanding</th>
                  <th className="py-2 pr-3 text-right font-normal">Max late</th>
                  <th className="py-2 pr-3 text-right font-normal">Cached balance</th>
                </tr>
              </thead>
              <tbody>
                {customers.map((c) => {
                  const url = buildDrilldownUrl('customer', c.customer_id);
                  const name = c.company ?? c.customer_name;
                  const drift = Math.abs(c.total_outstanding - c.balance_cached) > DRIFT_TOLERANCE;
                  const over  = c.credit_limit !== null && c.balance_cached > c.credit_limit;
                  return (
                    <tr key={c.customer_id} className="border-b border-border-subtle">
                      <td className="py-2">
                        {url !== null ? (
                          <Link
                            to={url}
                            className={cn('text-gold underline-offset-2 hover:underline', FOCUS_RING)}
                          >
                            {name}
                          </Link>
                        ) : name}
                      </td>
                      <td className={NUM_CELL}>{c.terms_days} d</td>
                      <td className={cn(NUM_CELL, over && 'font-semibold text-danger')}>
                        {c.credit_limit !== null ? formatIdrFull(c.credit_limit) : 'unlimited'}
                        {over && ' · over'}
                      </td>
                      <td className={cn(NUM_CELL, 'font-semibold')}>{formatIdrFull(c.total_outstanding)}</td>
                      <td className={NUM_CELL}>
                        <LatePill daysLate={c.max_days_late} />
                      </td>
                      <td className={NUM_CELL}>
                        {formatIdrFull(c.balance_cached)}
                        {/* Le drift n'est jamais masqué : la partie partiellement
                            réglée vit dans le cache, pas dans les allocations. */}
                        {drift && (
                          <span className="pl-1 text-xs font-semibold text-warning">drift</span>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </PanelCard>
    </ReportShell>
  );
}
