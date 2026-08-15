// apps/backoffice/src/pages/reports/CostSpendAnalyticsPage.tsx
//
// Lot E (campagne Reports 2026-08-15) — vague Finance, page 8/8. Migrée sur le
// socle Report shell v2 (archétype maquette 4c, patron : DailySalesPage).
//
// LA STRUCTURE EST CONSERVÉE : bande de KPI, composition journalière en héro,
// les deux ventilations par catégorie, et le partage COGS ↔ OpEx. Le langage
// des DEUX FAMILLES DE COÛT reste lui aussi intact — achats matière en BLEU,
// charges d'exploitation en AMBRE — parce qu'il dit à quel poste du compte de
// résultat une série appartient.
//
// CE QUI NE CHANGE PAS non plus : les montants viennent de
// `get_purchase_cogs_breakdown_v1`, `get_expenses_by_category_v1` et
// `get_profit_loss_v2` ; la page ne fait qu'additionner les deux enveloppes de
// dépense et rapporter au chiffre d'affaires. Aucun coût n'est réparti,
// re-valorisé ni imputé ici.
//
// Ce qui change :
//  1. Les deux donuts deviennent des cartes de ventilation à pistes : chaque
//     ligne est étiquetée en direct, l'identité ne repose plus sur la couleur.
//     Reste UN graphe, la composition journalière, en barres empilées — l'aire
//     donnait à lire des valeurs entre deux jours, qui n'existent pas.
//  2. La comparaison est méritée sur un écran de coûts : chaque tuile porte sa
//     variation, la HAUSSE en rouge.
//  3. Le partage de coût perd son `text-white` en dur (une couleur hors thème)
//     et ses étiquettes sur fond coloré, illisibles sur les segments étroits.
//
// Params URL : `start` / `end` / `cmp`.

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
import { usePurchaseCogsBreakdown } from '@/features/reports/hooks/usePurchaseCogsBreakdown.js';
import { useExpensesByCategory } from '@/features/reports/hooks/useExpensesByCategory.js';
import { useProfitLoss } from '@/features/reports/hooks/useProfitLoss.js';
import {
  COGS_BASE, OPEX_BASE, familyColor, formatIdrCompact, formatIdrFull,
} from '@/features/reports/utils/chartColors.js';
import {
  formatCount, formatPct1, pctChange, periodLabel, sharePct, shortDate, topSlice,
} from '@/features/reports/utils/reportFigures.js';

interface DailyCost {
  date: string;
  cogs: number;
  opex: number;
  /** Signature d'index EXPLICITE : recharts attend un `Record<string, unknown>`
   *  et une interface, contrairement à un alias, n'en reçoit aucune
   *  implicitement. La poser ici évite un cast au point d'appel. */
  [k: string]: string | number;
}

const csvColumns: CsvColumn<DailyCost>[] = [
  { header: 'Date',            accessor: (r) => r.date,          format: 'text' },
  { header: 'Purchases (IDR)', accessor: (r) => r.cogs,          format: 'idr-round100' },
  { header: 'OpEx (IDR)',      accessor: (r) => r.opex,          format: 'idr-round100' },
  { header: 'Total (IDR)',     accessor: (r) => r.cogs + r.opex, format: 'idr-round100' },
];

const SPEND_SERIES: StackedSeries[] = [
  { key: 'cogs', name: 'Purchases', color: COGS_BASE },
  { key: 'opex', name: 'OpEx',      color: OPEX_BASE },
];

/** Fusionne les deux séries journalières en un jeu empilable. */
function mergeDaily(
  cogsDays: { date: string; total: number }[],
  opexDays: { date: string; total: number }[],
): DailyCost[] {
  const map = new Map<string, DailyCost>();
  for (const d of cogsDays) map.set(d.date, { date: d.date, cogs: d.total, opex: 0 });
  for (const d of opexDays) {
    const cur = map.get(d.date) ?? { date: d.date, cogs: 0, opex: 0 };
    cur.opex = d.total;
    map.set(d.date, cur);
  }
  return [...map.values()].sort((a, b) => a.date.localeCompare(b.date));
}

interface KpiDescriptor {
  key: string; label: string; value: string; title?: string;
  delta?: number | null; unit?: 'pct' | 'pt'; invert?: boolean; note?: string | undefined;
}

export default function CostSpendAnalyticsPage(): JSX.Element {
  const period = useReportPeriod();
  const { start, end, compareRange } = period;

  const cogs = usePurchaseCogsBreakdown({ start, end });
  const opex = useExpensesByCategory({ start, end });
  const pnl  = useProfitLoss(start, end);

  const cogsPrev = usePurchaseCogsBreakdown({ start: compareRange.start, end: compareRange.end });
  const opexPrev = useExpensesByCategory({ start: compareRange.start, end: compareRange.end });
  const pnlPrev  = useProfitLoss(compareRange.start, compareRange.end);

  const purchasesTotal = cogs.data?.summary.total ?? 0;
  const opexTotal      = opex.data?.summary.total ?? 0;
  const totalSpend     = purchasesTotal + opexTotal;
  const revenue        = pnl.data?.revenue.total ?? 0;

  const prevPurchases = cogsPrev.data?.summary.total;
  const prevOpex      = opexPrev.data?.summary.total;
  const prevRevenue   = pnlPrev.data?.revenue.total;
  const prevSpend     = prevPurchases !== undefined && prevOpex !== undefined
    ? prevPurchases + prevOpex
    : undefined;

  const spendRatio = sharePct(totalSpend, revenue);
  // Un ratio ne se compare pas à une période SANS CHIFFRE D'AFFAIRES :
  // `sharePct` rend 0 sur base nulle, et l'écart afficherait un plein swing là
  // où il n'y a aucune comparaison. Base nulle → tiret.
  const prevSpendRatio = prevSpend !== undefined && prevRevenue !== undefined && prevRevenue > 0
    ? sharePct(prevSpend, prevRevenue)
    : undefined;

  const series = useMemo(
    () => mergeDaily(cogs.data?.by_day ?? [], opex.data?.by_day ?? []),
    [cogs.data?.by_day, opex.data?.by_day],
  );

  const purchaseCats = useMemo(
    () => (cogs.data?.by_category ?? []).slice().sort((a, b) => b.total - a.total),
    [cogs.data?.by_category],
  );
  const opexCats = useMemo(
    () => (opex.data?.by_category ?? []).slice().sort((a, b) => b.total - a.total),
    [opex.data?.by_category],
  );

  const purchaseTop = topSlice(purchaseCats, (c) => c.total, 'spend');
  const opexTop     = topSlice(opexCats,     (c) => c.total, 'spend');

  const purchaseRows: BreakdownRow[] = purchaseTop.rows.map((c, i) => ({
    key: c.category_id || c.name, label: c.name, amount: c.total,
    sharePct: sharePct(c.total, purchaseTop.total), color: familyColor('cogs', i),
  }));
  const opexRows: BreakdownRow[] = opexTop.rows.map((c, i) => ({
    key: c.category_id || c.name, label: c.name, amount: c.total,
    sharePct: sharePct(c.total, opexTop.total), color: familyColor('opex', i),
    count: `${formatCount(c.count)}×`,
  }));

  // Le partage des deux familles : deux lignes, une barre, aucune étiquette
  // posée sur un aplat coloré.
  const structureRows: BreakdownRow[] = [
    { key: 'cogs', label: 'Purchases', amount: purchasesTotal,
      sharePct: sharePct(purchasesTotal, totalSpend), color: COGS_BASE },
    { key: 'opex', label: 'OpEx', amount: opexTotal,
      sharePct: sharePct(opexTotal, totalSpend), color: OPEX_BASE },
  ];
  const structureSegments: ShareSegment[] = structureRows
    .filter((r) => (r.sharePct ?? 0) > 0)
    .map((r) => ({ label: r.label, pct: r.sharePct ?? 0, color: r.color ?? COGS_BASE }));

  const isLoading = cogs.isLoading || opex.isLoading;
  // Audit R-12 — `pnl.error` était ignoré : si le P&L échouait, la tuile
  // « Revenue » affichait un 0 silencieux et tous les « % of sales »
  // disparaissaient sans explication.
  const error = cogs.error ?? opex.error ?? pnl.error;
  const hasCompare = period.compare
    && cogsPrev.data !== undefined && opexPrev.data !== undefined;

  const pctOfSales = (n: number): string | undefined =>
    revenue > 0 ? `${formatPct1(sharePct(n, revenue))} of sales` : undefined;

  const tiles: KpiDescriptor[] = [
    {
      key: 'total-spend', label: 'Total spend',
      value: formatIdrCompact(totalSpend), title: formatIdrFull(totalSpend),
      delta: pctChange(totalSpend, prevSpend), invert: true,
      ...(pctOfSales(totalSpend) !== undefined ? { note: pctOfSales(totalSpend) } : {}),
    },
    {
      key: 'purchases', label: 'Material purchases',
      value: formatIdrCompact(purchasesTotal), title: formatIdrFull(purchasesTotal),
      delta: pctChange(purchasesTotal, prevPurchases), invert: true,
      ...(pctOfSales(purchasesTotal) !== undefined ? { note: pctOfSales(purchasesTotal) } : {}),
    },
    {
      key: 'opex', label: 'Operating expenses',
      value: formatIdrCompact(opexTotal), title: formatIdrFull(opexTotal),
      delta: pctChange(opexTotal, prevOpex), invert: true,
      ...(pctOfSales(opexTotal) !== undefined ? { note: pctOfSales(opexTotal) } : {}),
    },
    {
      key: 'revenue', label: 'Revenue (period)',
      value: formatIdrCompact(revenue), title: formatIdrFull(revenue),
      delta: pctChange(revenue, prevRevenue),
    },
    {
      // Un RATIO se compare en points, pas en pour-cent d'un pour-cent.
      key: 'spend-ratio', label: 'Spend ÷ revenue',
      value: revenue > 0 ? formatPct1(spendRatio) : '—',
      delta: prevSpendRatio !== undefined && revenue > 0 ? spendRatio - prevSpendRatio : null,
      unit:  'pt', invert: true,
      note:  revenue > 0 ? `${formatPct1(100 - spendRatio)} left after spend` : 'no revenue booked',
    },
  ];

  const meta = [
    periodLabel(start, end),
    'material purchasing (COGS) and operating expenses',
  ].join(' · ');

  const toolbar = (
    <>
      <PeriodControl period={period} showCompare />
      <ExportMenu
        csv={{ rows: series, columns: csvColumns, filename: `cost-spend-${start}_${end}` }}
        disabled={series.length === 0}
      />
    </>
  );

  return (
    <ReportShell
      title="Cost & Spend Analytics"
      subtitle={meta}
      breadcrumb={[{ label: 'Reports', to: '/backoffice/reports' }, { label: 'Financial' }]}
      toolbar={toolbar}
      error={error ?? null}
      isEmpty={
        !isLoading && error == null
        && cogs.data !== undefined && opex.data !== undefined
        && totalSpend === 0 && series.length === 0
      }
      emptyState={{
        title: 'No spend',
        description: 'No material purchase and no operating expense in the selected period.',
      }}
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
              {t.delta !== undefined && (
                <Delta
                  value={t.delta}
                  unit={t.unit ?? 'pct'}
                  period="prev"
                  invert={t.invert === true}
                  onInk={i === 0}
                />
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
          title="Spend composition"
          subtitle="Daily material purchases vs operating expenses"
          aside={hasCompare ? (
            <span className="text-xs text-text-muted">
              prev. total {formatIdrCompact(prevSpend ?? 0)}
            </span>
          ) : undefined}
          isLoading={isLoading}
          testId="chart-spend-composition"
        >
          <StackedBarsChart
            data={series}
            xKey="date"
            series={SPEND_SERIES}
            xTickFormatter={(v) => shortDate(String(v))}
            ariaLabel={`Daily spend stacked by cost family, material purchases and operating expenses, ${start} to ${end}.`}
          />
        </PanelCard>
        <BreakdownCard
          title="Cost structure"
          subtitle="Share of total spend by cost family"
          variant="track"
          rows={structureRows}
          total={{ label: 'Total spend', amount: totalSpend }}
          isLoading={isLoading}
          shareBar={{
            title:     'Purchases vs OpEx',
            ariaLabel: 'Share of total spend between material purchases and operating expenses',
            segments:  structureSegments,
          }}
          shareBarPlacement="after-total"
          emptyText="No spend to ventilate for this period."
          testId="breakdown-cost-structure"
        />
      </div>

      <div className="mt-3 grid gap-3 lg:grid-cols-2">
        <BreakdownCard
          title="Purchases by category"
          subtitle={purchaseTop.note ?? 'Material spend per product category.'}
          variant="track"
          rows={purchaseRows}
          total={{ label: 'Total purchases', amount: purchaseTop.total }}
          isLoading={cogs.isLoading}
          error={cogs.error}
          emptyText="No material purchase in this period."
          testId="breakdown-purchase-categories"
        />
        <BreakdownCard
          title="OpEx by category"
          subtitle={opexTop.note ?? 'Operating expense per category.'}
          variant="track"
          rows={opexRows}
          total={{ label: 'Total OpEx', amount: opexTop.total }}
          isLoading={opex.isLoading}
          error={opex.error}
          emptyText="No operating expense in this period."
          testId="breakdown-opex-categories"
        />
      </div>
    </ReportShell>
  );
}
