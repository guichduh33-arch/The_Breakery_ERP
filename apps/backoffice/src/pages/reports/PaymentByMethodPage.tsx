// apps/backoffice/src/pages/reports/PaymentByMethodPage.tsx
//
// Lot E (campagne Reports 2026-08-15) — vague Finance, page 3/8. Migrée sur le
// socle Report shell v2 (archétype maquette 4c, patron : DailySalesPage).
//
// CE QUI NE CHANGE PAS : les montants, parts, frais estimés et nets estimés
// viennent de `get_payments_by_method_v3` et sont rendus tels quels. Les frais
// restent INFORMATIFS (ADR-006 déc. 9, `business_config.payment_method_fees`) :
// ils n'entrent dans aucune écriture comptable.
//
// Ce que la page dit désormais et taisait :
//
//  1. LE SPLIT-TENDER EST VISIBLE. `total_count` et `total_orders` étaient
//     câblés côté hook (lot A1, finding F-06) et affichés nulle part : une
//     commande peut porter plusieurs règlements, et compter les paiements pour
//     des commandes surestime le trafic. La bande porte les deux, et la carte
//     de ventilation dit « N payments across M orders ».
//  2. LA TENDANCE PASSE EN BARRES EMPILÉES. C'était une aire empilée : une aire
//     interpole entre deux jours et donne à lire une valeur au milieu d'un
//     segment, qui n'a jamais existé. Les relevés sont journaliers et discrets.
//
// Params URL : `start` / `end` (noms déjà standards). Pas de comparaison — la
// question de cet écran est une COMPOSITION, pas une évolution.

import { useMemo, type JSX } from 'react';
import type { CsvColumn } from '@breakery/domain';
import { PanelCard } from '@/components/PanelCard.js';
import { KpiTile, KPI_NOTE, KPI_NOTE_HERO } from '@/components/kpi/KpiTile.js';
import { ReportShell } from '@/features/reports/components/ReportShell.js';
import { KpiBand } from '@/features/reports/components/KpiBand.js';
import { PeriodControl } from '@/features/reports/components/PeriodControl.js';
import { ExportMenu } from '@/features/reports/components/ExportMenu.js';
import { DrilldownLink } from '@/features/reports/components/DrilldownLink.js';
import {
  BreakdownCard, type BreakdownRow,
} from '@/features/reports/components/BreakdownCard.js';
import {
  StackedBarsChart, type StackedSeries,
} from '@/features/reports/components/charts/StackedBarsChart.js';
import { useReportPeriod } from '@/features/reports/hooks/useReportPeriod.js';
import { buildDrilldownUrl } from '@/features/reports/utils/buildDrilldownUrl.js';
import {
  categoricalColor, formatIdrCompact, formatIdrFull,
} from '@/features/reports/utils/chartColors.js';
import { formatCount, formatPct1, periodLabel } from '@/features/reports/utils/reportFigures.js';
// Le libellé d'une méthode est écrit à UN endroit (`features/orders/statusMeta`),
// jamais recalculé. Cette page portait un troisième `methodLabel` local qui
// capitalisait le jeton d'enum : il rendait « Qris » et « Edc » là où le reste du
// produit écrit « QRIS » et « EDC » — dans la table, dans la légende du graphe et
// dans la note du leader, soit trois endroits sur le même écran
// (critique du 2026-08-26). La CLÉ reste celle de Postgres ; seul l'affichage
// passe par la map.
import { paymentMethodLabel } from '@/features/orders/statusMeta.js';
import {
  usePaymentsByMethod, PAYMENT_METHOD_KEYS, type PaymentByMethodLine,
} from '@/features/reports/hooks/usePaymentsByMethod.js';

// Lot C (ADR-006 déc. 9) — frais informatifs par méthode : fee_pct vient de
// business_config.payment_method_fees, fee_est/net_est sont calculés serveur.
const csvColumns: CsvColumn<PaymentByMethodLine>[] = [
  { header: 'Method',         accessor: (r) => r.method,           format: 'text' },
  { header: 'Amount (IDR)',   accessor: (r) => r.amount,           format: 'idr-round100' },
  { header: 'Count',          accessor: (r) => r.count,            format: 'number' },
  { header: 'Share (%)',      accessor: (r) => r.share_pct / 100,  format: 'percent' },
  { header: 'Fee (%)',        accessor: (r) => r.fee_pct / 100,    format: 'percent' },
  { header: 'Fee est. (IDR)', accessor: (r) => r.fee_est,          format: 'idr-round100' },
  { header: 'Net est. (IDR)', accessor: (r) => r.net_est,          format: 'idr-round100' },
];

const idr = formatIdrFull;
const NUM_CELL = 'py-2 text-right font-data tabular-nums';

interface KpiDescriptor {
  key: string; label: string; value: string; title?: string; note?: string | undefined;
}

export default function PaymentByMethodPage(): JSX.Element {
  const period = useReportPeriod();
  const { start, end } = period;

  const { data, isLoading, error } = usePaymentsByMethod({ start, end });

  const lines = useMemo(() => data?.lines ?? [], [data]);
  const byDay = useMemo(() => data?.byDay ?? [], [data]);

  // N'empiler que les méthodes réellement utilisées sur la période : le pivot
  // serveur renvoie les 10 colonnes systématiquement, dont 7 à zéro en général.
  // L'ordre suit l'enum, jamais le rang du jour : un tri par valeur repeindrait
  // la pile d'un jour à l'autre.
  const series = useMemo<StackedSeries[]>(
    () => PAYMENT_METHOD_KEYS
      .filter((k) => byDay.some((d) => d[k] > 0))
      .map((k, i) => ({ key: k, name: paymentMethodLabel(k), color: categoricalColor(i) })),
    [byDay],
  );

  const methodRows: BreakdownRow[] = lines.map((l, i) => {
    const url = buildDrilldownUrl('order_list', '', { payment_method: l.method, start, end });
    return {
      key:      l.method,
      label:    paymentMethodLabel(l.method),
      amount:   l.amount,
      sharePct: l.share_pct,
      color:    categoricalColor(i),
      ...(url !== null ? { to: url } : {}),
    };
  });

  const totalCount   = data?.totalCount ?? 0;
  const totalOrders  = data?.totalOrders ?? 0;
  const perOrder     = totalOrders > 0 ? totalCount / totalOrders : 0;
  const leader       = lines.reduce<PaymentByMethodLine | null>(
    (b, l) => (b === null || l.amount > b.amount ? l : b), null,
  );

  const tiles: KpiDescriptor[] = [
    {
      key: 'collected', label: 'Total collected',
      value: formatIdrCompact(data?.total ?? 0), title: formatIdrFull(data?.total ?? 0),
      note:  leader !== null ? `${paymentMethodLabel(leader.method)} leads` : undefined,
    },
    { key: 'payments', label: 'Payments', value: formatCount(totalCount) },
    { key: 'orders',   label: 'Orders',   value: formatCount(totalOrders) },
    {
      // Au-dessus de 1,00, une commande porte plusieurs règlements : c'est le
      // split-tender, et il explique pourquoi paiements ≠ commandes.
      key: 'per-order', label: 'Payments / order',
      value: perOrder > 0
        ? perOrder.toLocaleString('id-ID', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
        : '—',
      note: 'split tender above 1,00',
    },
    {
      key: 'fees', label: 'Fees est.',
      value: formatIdrCompact(data?.totalFees ?? 0), title: formatIdrFull(data?.totalFees ?? 0),
      note:  'informative, not booked',
    },
    {
      key: 'net', label: 'Net est.',
      value: formatIdrCompact(data?.totalNet ?? 0), title: formatIdrFull(data?.totalNet ?? 0),
    },
  ];

  const meta = [
    periodLabel(start, end),
    `${formatCount(lines.length)} method${lines.length === 1 ? '' : 's'} used`,
    'fees are informative only',
  ].join(' · ');

  const toolbar = (
    <>
      <PeriodControl period={period} />
      <ExportMenu
        csv={{ rows: lines, columns: csvColumns, filename: `payment-by-method-${start}_${end}` }}
        {...(data !== undefined
          ? {
              pdf: {
                template: 'payment_by_method' as const,
                data,
                period:   { start, end },
                filename: `payment-by-method-${start}_${end}`,
              },
            }
          : {})}
        disabled={lines.length === 0}
      />
    </>
  );

  return (
    <ReportShell
      title="Payment by Method"
      subtitle={meta}
      breadcrumb={[{ label: 'Reports', to: '/backoffice/reports' }, { label: 'Financial' }]}
      toolbar={toolbar}
      error={error}
      isEmpty={!isLoading && data !== undefined && lines.length === 0}
      emptyState={{ title: 'No payments', description: 'No payment data for this period.' }}
      kpis={
        <KpiBand isLoading={isLoading} tiles={tiles.length} labels={tiles.map((t) => t.label)}>
          {tiles.map((t, i) => (
            <KpiTile
              key={t.key}
              label={t.label}
              value={t.value}
              {...(t.title !== undefined ? { valueTitle: t.title } : {})}
              hero={i === 0}
              testId={`kpi-${t.key}`}
            >
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
          title="Daily trend"
          subtitle="Collected per day, stacked by payment method"
          isLoading={isLoading}
          testId="chart-payments-by-day"
        >
          {series.length > 0 ? (
            <StackedBarsChart
              data={byDay}
              xKey="day"
              series={series}
              xTickFormatter={(v) => String(v).slice(5)}
              ariaLabel={`Daily collections stacked by payment method, ${start} to ${end}.`}
            />
          ) : (
            <p className="py-2 text-xs text-text-muted">
              No day-by-day breakdown for this period.
            </p>
          )}
        </PanelCard>
        <BreakdownCard
          title="Method share"
          rows={methodRows}
          total={{ label: 'Total collected', amount: data?.total ?? 0 }}
          isLoading={isLoading}
          error={error}
          footer={
            <span className="text-text-muted">
              {formatCount(totalCount)} payments across {formatCount(totalOrders)} orders
            </span>
          }
          testId="breakdown-methods"
        />
      </div>

      <PanelCard title="Method detail" className="mt-3" isLoading={isLoading} testId="pbm-method-detail">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <caption className="sr-only">
              Amount, count, share and estimated fees per payment method
            </caption>
            <thead>
              <tr className="border-b border-border-subtle text-text-secondary">
                <th scope="col" className="py-2 text-left">Method</th>
                <th scope="col" className="py-2 text-right">Amount (IDR)</th>
                <th scope="col" className="py-2 text-right">Count</th>
                <th scope="col" className="py-2 text-right">Share</th>
                <th scope="col" className="py-2 text-right">Fee</th>
                <th scope="col" className="py-2 text-right">Fee est.</th>
                <th scope="col" className="py-2 text-right">Net est.</th>
              </tr>
            </thead>
            <tbody>
              {lines.map((r) => (
                <tr key={r.method} className="border-b border-border-subtle">
                  {/* `capitalize` retiré avec le helper local : la classe
                      transformait le JETON d'enum en « Qris », et elle aurait
                      re-cassé « QRIS » que la map rend maintenant correctement. */}
                  <td className="py-2 font-medium">
                    <DrilldownLink
                      entity="order_list"
                      id=""
                      label={paymentMethodLabel(r.method)}
                      filter={{ payment_method: r.method, start, end }}
                      icon={false}
                    />
                  </td>
                  <td className={NUM_CELL}>{idr(r.amount)}</td>
                  <td className={NUM_CELL}>{formatCount(r.count)}</td>
                  <td className={NUM_CELL}>{formatPct1(r.share_pct)}</td>
                  <td className={NUM_CELL}>{r.fee_pct > 0 ? `${r.fee_pct}%` : '—'}</td>
                  <td className={NUM_CELL}>{idr(r.fee_est)}</td>
                  <td className={NUM_CELL}>{idr(r.net_est)}</td>
                </tr>
              ))}
            </tbody>
            {lines.length > 0 && (
              <tfoot>
                <tr className="border-t border-border-subtle font-semibold">
                  <td className="py-2">Total</td>
                  <td className={NUM_CELL}>{idr(data?.total ?? 0)}</td>
                  <td className={NUM_CELL}>{formatCount(totalCount)}</td>
                  <td className={NUM_CELL}>100%</td>
                  <td className="py-2" />
                  <td className={NUM_CELL}>{idr(data?.totalFees ?? 0)}</td>
                  <td className={NUM_CELL}>{idr(data?.totalNet ?? 0)}</td>
                </tr>
              </tfoot>
            )}
          </table>
        </div>
      </PanelCard>
    </ReportShell>
  );
}
