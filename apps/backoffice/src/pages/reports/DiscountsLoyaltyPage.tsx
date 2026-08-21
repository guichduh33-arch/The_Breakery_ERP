// apps/backoffice/src/pages/reports/DiscountsLoyaltyPage.tsx
//
// « Discounts & Loyalty » — l'argent consenti. Famille Sales, archétype Report
// (socle Report shell v2) ; patron : SalesByProductPage. Question tranchée :
// « combien de marge je consens, par quel levier, autorisé par qui — et la
// fidélité émet-elle plus qu'elle ne brûle ? » (validée par Mamat 2026-08-17).
//
// TROIS CHOSES QUE CETTE PAGE DIT ET QU'AUCUNE AUTRE NE DISAIT :
//
//  1. QUATRE LEVIERS, UNE SEULE SOMME. Remise de ligne, remise de commande
//     (PIN), promotions, points brûlés — chacun existait éparpillé, aucun écran
//     ne les additionnait. Le total, le taux et les parts se recalculent des
//     ventilations servies : la bande ne peut pas diverger.
//  2. CHAQUE REMISE PIN EST SIGNÉE. Motif + manager autorisant, en clair — la
//     table de contrôle anti-abus que le POS promettait sans la montrer.
//  3. LES POINTS ONT DEUX PRIX, JAMAIS CONFONDUS. Le consenti = le montant
//     RÉELLEMENT décompté à l'encaissement (orders.loyalty_redemption_amount) ;
//     le passif PROJETÉ du solde net = points × REDEMPTION_RATE (constante
//     domain, étiquetée comme projection). L'émission ne coûte rien le jour où
//     elle a lieu — elle gonfle un passif, la tuile le dit.
//
// Frontière : le ROI des promotions (lift, redemptions) vit dans Marketing ›
// Promo ROI — cette page dit le COÛT. Le prix négocié B2B n'est pas une remise.

import { useMemo, type JSX } from 'react';
import { Link } from 'react-router-dom';
import { cn } from '@breakery/ui';
import { REDEMPTION_RATE, type CsvColumn } from '@breakery/domain';
import { PanelCard } from '@/components/PanelCard.js';
import { KpiTile, KPI_NOTE, KPI_NOTE_HERO } from '@/components/kpi/KpiTile.js';
import { Delta } from '@/components/kpi/Delta.js';
import { FOCUS_RING } from '@/components/focusRing.js';
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
import { PairedBarsChart } from '@/features/reports/components/charts/PairedBarsChart.js';
import { useReportPeriod } from '@/features/reports/hooks/useReportPeriod.js';
import {
  useDiscountsLoyalty, type PinDiscountRow,
} from '@/features/reports/hooks/useDiscountsLoyalty.js';
import { buildDrilldownUrl } from '@/features/reports/utils/buildDrilldownUrl.js';
import {
  categoricalColor, formatIdrCompact, formatIdrFull,
} from '@/features/reports/utils/chartColors.js';
import {
  eachDay, formatCount, formatPct1, pctChange, periodLabel, shortDate, sharePct,
} from '@/features/reports/utils/reportFigures.js';

/** Ordre d'IDENTITÉ des leviers — l'empilement et la ventilation le suivent,
 *  jamais le rang par valeur (un tri repeindrait la pile chaque période). */
const LEVERS = [
  { key: 'line_discount',    label: 'Line discounts' },
  { key: 'order_discount',   label: 'Order discounts (PIN)' },
  { key: 'promotion',        label: 'Promotions' },
  { key: 'redemption_value', label: 'Points redeemed' },
] as const;

const STACK_SERIES: StackedSeries[] = LEVERS.map((l, i) => ({
  key: l.key, name: l.label, color: categoricalColor(i),
}));

const csvColumns: CsvColumn<PinDiscountRow>[] = [
  { header: 'Date',          accessor: (r) => r.business_date,             format: 'text' },
  { header: 'Order #',       accessor: (r) => r.order_number,              format: 'text' },
  { header: 'Reason',        accessor: (r) => r.reason ?? '',              format: 'text' },
  { header: 'Authorized by', accessor: (r) => r.authorized_by.name ?? '',  format: 'text' },
  { header: 'Amount',        accessor: (r) => r.amount,                    format: 'idr-round100' },
];

const NUM_CELL = 'py-2 text-right font-data tabular-nums';
/** Lignes visibles du panneau PIN — la liste entière part au CSV. */
const PIN_SHOWN = 8;

interface KpiDescriptor {
  key: string; label: string; value: string;
  title?: string; delta?: number | null; note?: string;
}

export default function DiscountsLoyaltyPage(): JSX.Element {
  const period = useReportPeriod();
  const { start, end } = period;

  const report = useDiscountsLoyalty({ start, end });
  const summary = report.data?.summary;
  const pins    = report.data?.pin_discounts ?? [];
  const promos  = report.data?.by_promotion ?? [];

  // ── Le total consenti et ses dérivés — recalculés des quatre leviers. ──────
  const consented = summary !== undefined
    ? summary.line_discount + summary.order_discount + summary.promotion + summary.redemption_value
    : 0;
  const consentedPrev = summary !== undefined
    ? summary.line_discount_prev + summary.order_discount_prev
      + summary.promotion_prev + summary.redemption_value_prev
    : 0;
  const rate     = summary !== undefined && summary.gross_sales > 0
    ? (consented / summary.gross_sales) * 100 : null;
  const ratePrev = summary !== undefined && summary.gross_sales_prev > 0
    ? (consentedPrev / summary.gross_sales_prev) * 100 : null;

  const leverRows: BreakdownRow[] = useMemo(() => {
    if (summary === undefined) return [];
    return LEVERS
      .map((l, i) => ({
        key:      l.key,
        label:    l.label,
        amount:   summary[l.key],
        sharePct: sharePct(summary[l.key], consented),
        color:    categoricalColor(i),
      }))
      .sort((a, b) => b.amount - a.amount);
  }, [summary, consented]);

  const topLever = leverRows[0];

  // Semaines : by_day plié en fenêtres de 7 jours (zéro-fill eachDay).
  const weekly = useMemo(() => {
    const byDate = new Map((report.data?.by_day ?? []).map((d) => [d.date, d]));
    const days = eachDay(start, end);
    const out: Record<string, unknown>[] = [];
    for (let i = 0; i < days.length; i += 7) {
      const chunk = days.slice(i, i + 7);
      const first = chunk[0];
      if (first === undefined) break;
      const row: Record<string, number | string> = {
        label: shortDate(first),
        line_discount: 0, order_discount: 0, promotion: 0, redemption_value: 0,
        points_issued: 0, points_burned: 0,
      };
      for (const d of chunk) {
        const src = byDate.get(d);
        if (src === undefined) continue;
        for (const k of [
          'line_discount', 'order_discount', 'promotion', 'redemption_value',
          'points_issued', 'points_burned',
        ] as const) {
          row[k] = (row[k] as number) + src[k];
        }
      }
      out.push(row);
    }
    return out;
  }, [report.data, start, end]);

  const netPoints = (summary?.points_issued ?? 0) - (summary?.points_burned ?? 0);

  const tiles: KpiDescriptor[] = [
    {
      key: 'consented', label: 'Money given away',
      value: formatIdrCompact(consented), title: formatIdrFull(consented),
      delta: pctChange(consented, consentedPrev),
      note:  'line + order + promos + points',
    },
    {
      key: 'rate', label: 'Give-away rate',
      value: rate === null ? '—' : formatPct1(rate),
      note:  rate === null
        ? 'no gross sales in this period'
        : `of gross sales · ${ratePrev === null ? 'no' : formatPct1(ratePrev)} previous period`,
    },
    {
      // Une variation n'a pas de sens sur un NOM : la tuile porte la part.
      key: 'top-lever', label: 'Top lever',
      value: topLever?.label ?? '—',
      note:  topLever !== undefined && consented > 0
        ? `${formatIdrCompact(topLever.amount)} · ${formatPct1(topLever.sharePct ?? 0)} of given away`
        : 'nothing given away',
    },
    {
      key: 'points', label: 'Points issued / burned',
      value: `${formatCount(summary?.points_issued ?? 0)} / ${formatCount(summary?.points_burned ?? 0)}`,
      // PROJECTION, étiquetée : le solde net valorisé à la constante domain.
      note:  `net ${netPoints >= 0 ? '+' : '−'}${formatCount(Math.abs(netPoints))} pts · projected liability ${formatIdrCompact(Math.abs(netPoints) * REDEMPTION_RATE)}`,
    },
    {
      key: 'pin', label: 'PIN discounts (order)',
      value: formatCount(summary?.pin_count ?? 0),
      note:  `${formatIdrCompact(summary?.order_discount ?? 0)} · every one signed below`,
    },
  ];

  const meta = [
    periodLabel(start, end),
    'four levers, vs the previous window of same length',
  ].join(' · ');

  const toolbar = (
    <>
      <PeriodControl period={period} />
      <ExportMenu
        csv={{ rows: pins, columns: csvColumns, filename: `discounts-loyalty-pin-${start}_${end}` }}
        disabled={pins.length === 0}
      />
    </>
  );

  const isEmpty = !report.isLoading && report.data !== undefined
    && consented === 0 && (summary?.points_issued ?? 0) === 0
    && (summary?.points_burned ?? 0) === 0;

  return (
    <ReportShell
      title="Discounts & Loyalty"
      subtitle={meta}
      breadcrumb={[{ label: 'Reports', to: '/backoffice/reports' }, { label: 'Sales' }]}
      toolbar={toolbar}
      error={report.error}
      isEmpty={isEmpty}
      emptyState={{
        title: 'Nothing given away',
        description: 'No discount, promotion or loyalty movement in the selected date range.',
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
              {/* Du consenti qui monte est une sortie de marge : invert. */}
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
        <strong>Four levers, one sum.</strong> Line discounts (the displayed price is already
        net — the figure is what was given on top), order discounts (PIN-authorized, signed
        below), promotions (descriptions frozen at application time), and points redeemed
        (valued at what was <em>actually</em> deducted at checkout — never points × a constant).
        Issuing points costs nothing on the day — it grows a liability, projected at
        Rp&nbsp;{String(REDEMPTION_RATE)}/pt (domain constant). A negotiated B2B price is
        pricing, not a discount. Promotion ROI lives in Marketing › Promo ROI — this page is
        the cost side.
      </p>

      <div className="mt-3 grid gap-3 xl:grid-cols-[1.7fr_1fr]">
        <PanelCard
          title="Given away per lever, weekly"
          aside={<span className="text-xs text-text-muted">Served daily, folded into weeks</span>}
          isLoading={report.isLoading}
          testId="chart-levers-weekly"
        >
          <StackedBarsChart
            data={weekly}
            xKey="label"
            series={STACK_SERIES}
            ariaLabel={`Money given away per lever, stacked per week from ${start} to ${end}.`}
          />
        </PanelCard>
        <BreakdownCard
          title="By lever"
          subtitle="Same figures as the band — the sum closes it."
          variant="track"
          rows={leverRows}
          total={{ label: 'Total given away', amount: consented }}
          isLoading={report.isLoading}
          error={report.error}
          shareBar={{
            title:     'Share of given away',
            ariaLabel: 'Share of money given away by lever',
            segments:  leverRows.map((r): ShareSegment => ({
              label: r.label, pct: r.sharePct ?? 0, color: r.color ?? categoricalColor(0),
            })),
          }}
          shareBarPlacement="after-total"
          emptyText="Nothing given away in this period."
          testId="breakdown-levers"
        />
      </div>

      <div className="mt-3 grid gap-3 xl:grid-cols-[1.7fr_1fr]">
        <PanelCard
          title="Order discounts — PIN-authorized"
          aside={
            <span className="text-xs text-text-muted">
              {formatCount(pins.length)} discounts · {formatIdrCompact(summary?.order_discount ?? 0)}
            </span>
          }
          isLoading={report.isLoading}
          testId="dl-pin-table"
        >
          {pins.length === 0 ? (
            <p className="py-6 text-center text-sm text-text-muted">
              No PIN-authorized order discount in this period.
            </p>
          ) : (
            <>
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <caption className="sr-only">
                    Order discounts with reason, authorizer and amount
                  </caption>
                  <thead>
                    <tr className="border-b border-border-subtle text-text-secondary">
                      <th scope="col" className="py-2 pr-3 text-left font-normal">Date</th>
                      <th scope="col" className="py-2 pr-3 text-left font-normal">Order</th>
                      <th scope="col" className="py-2 pr-3 text-left font-normal">Reason</th>
                      <th scope="col" className="py-2 pr-3 text-left font-normal">Authorized by</th>
                      <th scope="col" className="py-2 pr-3 text-right font-normal">Amount</th>
                    </tr>
                  </thead>
                  <tbody>
                    {pins.slice(0, PIN_SHOWN).map((p) => {
                      const url = buildDrilldownUrl('order', p.order_id);
                      return (
                        <tr key={p.order_id} className="border-b border-border-subtle">
                          <td className="py-2 text-text-secondary">{shortDate(p.business_date)}</td>
                          <td className="py-2">
                            {url !== null ? (
                              <Link
                                to={url}
                                className={cn('text-gold underline-offset-2 hover:underline', FOCUS_RING)}
                              >
                                {p.order_number}
                              </Link>
                            ) : p.order_number}
                          </td>
                          <td className="py-2 text-text-secondary">{p.reason ?? '—'}</td>
                          <td className="py-2 text-text-secondary">{p.authorized_by.name ?? '—'}</td>
                          <td className={NUM_CELL}>{formatIdrFull(p.amount)}</td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
              {pins.length > PIN_SHOWN && (
                <p className="pt-2 text-xs text-text-muted">
                  {PIN_SHOWN} of {formatCount(pins.length)} shown, by amount — the CSV export
                  carries them all.
                </p>
              )}
            </>
          )}
        </PanelCard>

        <PanelCard
          title="Points issued vs burned"
          aside={<span className="text-xs text-text-muted">Weekly, in points</span>}
          isLoading={report.isLoading}
          testId="chart-points-flow"
        >
          <PairedBarsChart
            data={weekly}
            xKey="label"
            currentKey="points_issued"
            currentName="Issued"
            compareKey="points_burned"
            compareName="Burned"
            yTickFormatter={(v) => formatCount(v)}
            valueFormatter={(v) => `${formatCount(v)} pts`}
            ariaLabel={`Loyalty points issued and burned per week from ${start} to ${end}.`}
          />
        </PanelCard>
      </div>

      <PanelCard
        title="By promotion"
        aside={<span className="text-xs text-text-muted">Cost only — ROI lives in Marketing › Promo ROI</span>}
        className="mt-3"
        isLoading={report.isLoading}
        testId="dl-promo-table"
      >
        {promos.length === 0 ? (
          <p className="py-6 text-center text-sm text-text-muted">
            No promotion applied in this period.
          </p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <caption className="sr-only">
                Applications and given-away amount per promotion
              </caption>
              <thead>
                <tr className="border-b border-border-subtle text-text-secondary">
                  <th scope="col" className="py-2 pr-3 text-left font-normal">Promotion</th>
                  <th scope="col" className="py-2 pr-3 text-right font-normal">Applications</th>
                  <th scope="col" className="py-2 pr-3 text-right font-normal">Amount</th>
                  <th scope="col" className="py-2 pr-3 text-right font-normal">Share of promos</th>
                </tr>
              </thead>
              <tbody>
                {promos.map((p) => (
                  <tr key={p.promotion_id} className="border-b border-border-subtle">
                    {/* Description SNAPSHOTÉE — lisible même promo supprimée. */}
                    <td className="py-2">{p.description ?? '—'}</td>
                    <td className={NUM_CELL}>{formatCount(p.applications)}</td>
                    <td className={NUM_CELL}>{formatIdrFull(p.amount)}</td>
                    <td className={NUM_CELL}>
                      {formatPct1(sharePct(p.amount, summary?.promotion ?? 0))}
                    </td>
                  </tr>
                ))}
              </tbody>
              <tfoot>
                <tr className="border-t border-border-subtle font-semibold">
                  <td className="py-2">Total promotions</td>
                  <td className={NUM_CELL}>
                    {formatCount(promos.reduce((s, p) => s + p.applications, 0))}
                  </td>
                  <td className={NUM_CELL}>{formatIdrFull(summary?.promotion ?? 0)}</td>
                  <td className={NUM_CELL}>100,0%</td>
                </tr>
              </tfoot>
            </table>
          </div>
        )}
      </PanelCard>
    </ReportShell>
  );
}
