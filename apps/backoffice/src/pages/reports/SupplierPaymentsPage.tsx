// apps/backoffice/src/pages/reports/SupplierPaymentsPage.tsx
//
// « Supplier Payments » — le symétrique de l'AR aging, côté dettes. Famille
// Purchases, archétype Report (socle Report shell v2) ; patron : ArAgingPage.
// Question tranchée : « qu'ai-je décaissé vers les fournisseurs, et combien
// reste-t-il à payer — à qui ? » (maquette + arbitrages validés par Mamat le
// 2026-08-17 : encours = PO reçus uniquement, imports historiques exclus).
//
// TROIS CHOSES QUE CETTE PAGE DIT ET QU'AUCUNE AUTRE NE DISAIT :
//
//  1. DEUX NATURES DE CHIFFRE, JAMAIS CONFONDUES. Le décaissé est périodique
//     (delta vs fenêtre précédente) ; l'encours est un snapshot daté — pas de
//     delta inventé sur un solde.
//  2. LA DETTE, PAS L'ENGAGEMENT. L'encours ne compte que les PO REÇUS
//     (marchandise entrée) — un PO commandé non reçu est une prévision.
//  3. LE DÉLAI DE RÈGLEMENT EST PONDÉRÉ. Réception → paiement, pondéré par
//     montant — payer vite les petites factures ne maquille pas le chiffre.

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
import { TrendLineChart } from '@/features/reports/components/charts/TrendLineChart.js';
import { ParetoChart } from '@/features/reports/components/charts/ParetoChart.js';
import { useReportPeriod } from '@/features/reports/hooks/useReportPeriod.js';
import {
  useSupplierPayments, type OpenPoRow,
} from '@/features/reports/hooks/useSupplierPayments.js';
import { buildDrilldownUrl } from '@/features/reports/utils/buildDrilldownUrl.js';
import { formatIdrCompact, formatIdrFull } from '@/features/reports/utils/chartColors.js';
import {
  eachDay, formatCount, pctChange, periodLabel, shortDate,
} from '@/features/reports/utils/reportFigures.js';

const csvColumns: CsvColumn<OpenPoRow>[] = [
  { header: 'Supplier',    accessor: (r) => r.supplier_name,      format: 'text' },
  { header: 'PO',          accessor: (r) => r.po_number,          format: 'text' },
  { header: 'Received',    accessor: (r) => r.received_on ?? '',  format: 'text' },
  { header: 'Age (days)',  accessor: (r) => r.age_days,           format: 'number' },
  { header: 'Total',       accessor: (r) => r.total,              format: 'idr-round100' },
  { header: 'Settled',     accessor: (r) => r.settled,            format: 'idr-round100' },
  { header: 'Outstanding', accessor: (r) => r.outstanding,        format: 'idr-round100' },
];

const NUM_CELL = 'py-2 text-right font-data tabular-nums';
/** Lignes visibles — la liste entière part au CSV. */
const POS_SHOWN = 10;
const PAYMENTS_SHOWN = 8;
const PARETO_SHOWN = 10;

export default function SupplierPaymentsPage(): JSX.Element {
  const period = useReportPeriod();
  const { start, end } = period;

  const report = useSupplierPayments({ start, end });
  const summary  = report.data?.summary;
  const openPos  = report.data?.open_pos ?? [];
  const payments = report.data?.payments ?? [];
  const asOf     = report.data?.as_of;

  // Décaissements par semaine — servi au jour, plié en fenêtres de 7 jours.
  const weekly = useMemo(() => {
    const byDate = new Map((report.data?.by_day ?? []).map((d) => [d.date, d.amount]));
    const days = eachDay(start, end);
    const out: Record<string, unknown>[] = [];
    for (let i = 0; i < days.length; i += 7) {
      const chunk = days.slice(i, i + 7);
      const first = chunk[0];
      if (first === undefined) break;
      let amount = 0;
      for (const d of chunk) amount += byDate.get(d) ?? 0;
      out.push({ label: shortDate(first), amount });
    }
    return out;
  }, [report.data, start, end]);

  const paretoRows = useMemo(
    () => (report.data?.by_supplier_outstanding ?? [])
      .slice(0, PARETO_SHOWN)
      .map((s) => ({ name: s.supplier_name, value: s.outstanding })),
    [report.data],
  );

  const tiles = [
    {
      key: 'paid', label: 'Paid out',
      value: formatIdrCompact(summary?.paid_total ?? 0),
      title: formatIdrFull(summary?.paid_total ?? 0),
      delta: pctChange(summary?.paid_total ?? 0, summary?.paid_total_prev ?? 0),
      note:  `${formatCount(summary?.payments_count ?? 0)} payments`,
    },
    {
      key: 'outstanding', label: 'Outstanding to suppliers',
      value: formatIdrCompact(summary?.outstanding_total ?? 0),
      title: formatIdrFull(summary?.outstanding_total ?? 0),
      note:  `snapshot as of ${asOf !== undefined && asOf !== '' ? shortDate(asOf) : '—'}`,
    },
    {
      key: 'open-pos', label: 'Unsettled POs',
      value: formatCount(summary?.open_po_count ?? 0),
      note:  (summary?.oldest_open_days ?? 0) > 0
        ? `oldest ${summary?.oldest_open_days} d since receipt`
        : 'every received PO is settled',
    },
    {
      key: 'settlement', label: 'Avg settlement delay',
      value: summary?.avg_settlement_days != null ? `${summary.avg_settlement_days} d` : '—',
      note:  summary?.avg_settlement_days != null
        ? 'receipt → payment, amount-weighted'
        : 'no settlement in this period',
    },
    {
      key: 'suppliers', label: 'Suppliers owed',
      value: formatCount(summary?.supplier_count ?? 0),
      note:  'with an open balance',
    },
  ];

  const meta = [
    periodLabel(start, end),
    'paid out vs the previous window · outstanding is a live snapshot',
  ].join(' · ');

  const toolbar = (
    <>
      <PeriodControl period={period} />
      <ExportMenu
        csv={{ rows: openPos, columns: csvColumns, filename: `supplier-outstanding-${asOf ?? 'snapshot'}` }}
        disabled={openPos.length === 0}
      />
    </>
  );

  const isEmpty = !report.isLoading && report.data !== undefined
    && (summary?.payments_count ?? 0) === 0 && (summary?.open_po_count ?? 0) === 0;

  return (
    <ReportShell
      title="Supplier Payments"
      subtitle={meta}
      breadcrumb={[{ label: 'Reports', to: '/backoffice/reports' }, { label: 'Purchases' }]}
      toolbar={toolbar}
      error={report.error}
      isEmpty={isEmpty}
      emptyState={{
        title: 'Nothing paid, nothing owed',
        description: 'No supplier payment in this period and no received PO left unsettled.',
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
              {/* Décaissé = delta ; encours = snapshot daté — jamais l'inverse. */}
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
        <strong>Debt, not commitment.</strong> The outstanding counts <em>received</em> POs
        only — goods in the door — minus what the payment ledger already covered; ordered
        but undelivered POs are commitments and stay out, and so do historical imports.
        The paid-out figure is the payment ledger over the selected period, business days.
      </p>

      <div className="mt-3 grid gap-3 xl:grid-cols-[1.7fr_1fr]">
        <PanelCard
          title="Paid out per week"
          aside={<span className="text-xs text-text-muted">Served daily, folded into weeks · previous window in the band</span>}
          isLoading={report.isLoading}
          testId="chart-payments-weekly"
        >
          <TrendLineChart
            data={weekly}
            xKey="label"
            currentKey="amount"
            currentName="Paid out"
            ariaLabel={`Supplier payments per week from ${start} to ${end}.`}
          />
        </PanelCard>
        <PanelCard
          title="Outstanding per supplier"
          aside={
            <span className="text-xs text-text-muted">
              Top {paretoRows.length} of {formatCount(report.data?.by_supplier_outstanding.length ?? 0)}
            </span>
          }
          isLoading={report.isLoading}
          testId="chart-supplier-pareto"
        >
          <ParetoChart
            data={paretoRows}
            xKey="name"
            valueKey="value"
            valueName="Outstanding"
            grandTotal={summary?.outstanding_total ?? 0}
            ariaLabel="Outstanding supplier balance, sorted descending with cumulative share."
          />
        </PanelCard>
      </div>

      <PanelCard
        title="Open purchase orders"
        aside={
          <span className="text-xs text-text-muted">
            {formatCount(openPos.length)} POs · oldest first — the CSV carries them all
          </span>
        }
        className="mt-3"
        isLoading={report.isLoading}
        testId="open-pos-table"
      >
        {openPos.length === 0 ? (
          <p className="py-6 text-center text-sm text-text-muted">
            Every received PO is settled.
          </p>
        ) : (
          <>
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <caption className="sr-only">
                  Received purchase orders with settled and outstanding amounts
                </caption>
                <thead>
                  <tr className="border-b border-border-subtle text-text-secondary">
                    <th className="py-2 pr-3 text-left font-normal">Supplier</th>
                    <th className="py-2 pr-3 text-left font-normal">PO</th>
                    <th className="py-2 pr-3 text-left font-normal">Received</th>
                    <th className="py-2 pr-3 text-right font-normal">Age</th>
                    <th className="py-2 pr-3 text-right font-normal">Total</th>
                    <th className="py-2 pr-3 text-right font-normal">Settled</th>
                    <th className="py-2 pr-3 text-right font-normal">Outstanding</th>
                  </tr>
                </thead>
                <tbody>
                  {openPos.slice(0, POS_SHOWN).map((po) => {
                    const supUrl = buildDrilldownUrl('supplier', po.supplier_id);
                    const poUrl  = buildDrilldownUrl('purchase_order', po.po_id);
                    return (
                      <tr key={po.po_id} className="border-b border-border-subtle">
                        <td className="py-2">
                          {supUrl !== null ? (
                            <Link
                              to={supUrl}
                              className={cn('text-gold underline-offset-2 hover:underline', FOCUS_RING)}
                            >
                              {po.supplier_name}
                            </Link>
                          ) : po.supplier_name}
                        </td>
                        <td className="py-2">
                          {poUrl !== null ? (
                            <Link
                              to={poUrl}
                              className={cn('text-gold underline-offset-2 hover:underline', FOCUS_RING)}
                            >
                              {po.po_number}
                            </Link>
                          ) : po.po_number}
                        </td>
                        <td className="py-2 text-text-secondary">
                          {po.received_on !== null ? shortDate(po.received_on) : '—'}
                        </td>
                        <td className={NUM_CELL}>{po.age_days} d</td>
                        <td className={NUM_CELL}>{formatIdrFull(po.total)}</td>
                        <td className={NUM_CELL}>{formatIdrFull(po.settled)}</td>
                        <td className={cn(NUM_CELL, 'font-semibold')}>{formatIdrFull(po.outstanding)}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
            {openPos.length > POS_SHOWN && (
              <p className="pt-2 text-xs text-text-muted">
                {POS_SHOWN} of {formatCount(openPos.length)} shown, oldest first — the CSV
                export carries them all.
              </p>
            )}
          </>
        )}
      </PanelCard>

      <PanelCard
        title="Payments in the period"
        aside={
          <span className="text-xs text-text-muted">
            {formatCount(payments.length)} payments · {formatIdrCompact(summary?.paid_total ?? 0)}
          </span>
        }
        className="mt-3"
        isLoading={report.isLoading}
        testId="payments-table"
      >
        {payments.length === 0 ? (
          <p className="py-6 text-center text-sm text-text-muted">
            No supplier payment in this period.
          </p>
        ) : (
          <>
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <caption className="sr-only">
                  Supplier payments with method and purchase order
                </caption>
                <thead>
                  <tr className="border-b border-border-subtle text-text-secondary">
                    <th className="py-2 pr-3 text-left font-normal">Date</th>
                    <th className="py-2 pr-3 text-left font-normal">Supplier</th>
                    <th className="py-2 pr-3 text-left font-normal">PO</th>
                    <th className="py-2 pr-3 text-left font-normal">Method</th>
                    <th className="py-2 pr-3 text-right font-normal">Amount</th>
                  </tr>
                </thead>
                <tbody>
                  {payments.slice(0, PAYMENTS_SHOWN).map((p) => (
                    <tr key={p.payment_id} className="border-b border-border-subtle">
                      <td className="py-2 text-text-secondary">{shortDate(p.paid_on)}</td>
                      <td className="py-2">{p.supplier_name}</td>
                      <td className="py-2 text-text-secondary">{p.po_number}</td>
                      <td className="py-2 text-text-secondary">{p.method}</td>
                      <td className={NUM_CELL}>{formatIdrFull(p.amount)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            {payments.length > PAYMENTS_SHOWN && (
              <p className="pt-2 text-xs text-text-muted">
                {PAYMENTS_SHOWN} of {formatCount(payments.length)} shown, latest first.
              </p>
            )}
          </>
        )}
      </PanelCard>
    </ReportShell>
  );
}
