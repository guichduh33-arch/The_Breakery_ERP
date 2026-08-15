// apps/backoffice/src/pages/reports/ProductionReportPage.tsx
//
// Lot F (campagne Reports 2026-08-15) — vague Inventory, page 3/10. Migrée sur
// le socle Report shell v2 (archétype maquette 4c, patron : DailySalesPage).
//
// CE QUI NE CHANGE PAS : `get_production_report_v1` sert le résumé, la
// ventilation par produit et la série journalière ; la page les rend. Aucune
// quantité n'est recalculée, aucune valeur re-valorisée.
//
// Ce qui change :
//  1. La rangée de quatre encadrés maison devient la BANDE DE KPI du socle, et
//     chaque tuile porte sa variation contre la période précédente.
//  2. La série journalière gagne son graphe. Ici un jour sans production vaut
//     bien ZÉRO — c'est un montant, et rien n'a été produit ; c'est l'inverse
//     d'un TAUX, qui lui manquerait (cf. ProductionEfficiencyPage).
//  3. Une carte de ventilation par produit ouvre l'écran sur « qui pèse », que
//     deux tables de chiffres bruts ne disaient pas. Elle coupe l'AFFICHAGE à
//     cinq lignes et totalise le jeu COMPLET.
//  4. Les deux tables restent, sous les cartes : elles portent les quantités par
//     produit ET par jour, que ni le graphe ni la carte ne rendent.
//
// LE TAUX DE PERTE est un rapport DÉRIVÉ, pas un champ servi : `qty_waste` sur
// `qty_produced`. Le libellé le dit, parce que « waste ÷ produced » et « waste ÷
// (produced + waste) » ne donnent pas le même nombre et que le payload ne
// tranche pas.
//
// Params URL : `start` / `end` / `cmp` — les bornes portaient déjà les noms du
// socle, aucun repli legacy n'est nécessaire.

import { useMemo, type JSX } from 'react';
import type { CsvColumn } from '@breakery/domain';
import { PanelCard } from '@/components/PanelCard.js';
import { KpiTile, KPI_NOTE, KPI_NOTE_HERO } from '@/components/kpi/KpiTile.js';
import { Delta } from '@/components/kpi/Delta.js';
import { ReportShell } from '@/features/reports/components/ReportShell.js';
import { KpiBand } from '@/features/reports/components/KpiBand.js';
import { PeriodControl } from '@/features/reports/components/PeriodControl.js';
import { ExportMenu } from '@/features/reports/components/ExportMenu.js';
import { BreakdownCard, type BreakdownRow } from '@/features/reports/components/BreakdownCard.js';
import { PairedBarsChart } from '@/features/reports/components/charts/PairedBarsChart.js';
import { DrilldownLink } from '@/features/reports/components/DrilldownLink.js';
import { useReportPeriod } from '@/features/reports/hooks/useReportPeriod.js';
import { categoricalColor, formatIdrCompact, formatIdrFull } from '@/features/reports/utils/chartColors.js';
import {
  eachDay, formatCount, formatPct1, pctChange, periodLabel, sharePct, shortDate, topSlice,
} from '@/features/reports/utils/reportFigures.js';
import {
  useProductionReport,
  type ProductionReportByDay,
  type ProductionReportByProduct,
} from '@/features/reports/hooks/useProductionReport.js';

const csvColumns: CsvColumn<ProductionReportByProduct>[] = [
  { header: 'Product',       accessor: (r) => r.product_name, format: 'text' },
  { header: 'Runs',          accessor: (r) => r.runs,          format: 'number' },
  { header: 'Qty Produced',  accessor: (r) => r.qty_produced,  format: 'number' },
  { header: 'Qty Waste',     accessor: (r) => r.qty_waste,     format: 'number' },
  { header: 'Value (IDR)',   accessor: (r) => r.value,         format: 'idr-round100' },
];

const NUM_CELL = 'py-2 text-right font-data tabular-nums';

interface DailyPoint {
  date:    string;
  current: number;
  compare: number;
  [k: string]: string | number;
}

/** Série journalière alignée : la comparaison suit le RANG du jour dans sa
 *  propre fenêtre, jamais sa date. */
function buildDaily(
  start: string, end: string,
  cmpStart: string, cmpEnd: string,
  cur: ProductionReportByDay[],
  prev: ProductionReportByDay[],
): DailyPoint[] {
  const cmpDays = eachDay(cmpStart, cmpEnd);
  const curMap = new Map(cur.map((d) => [d.date.slice(0, 10), d.value]));
  const cmpMap = new Map(prev.map((d) => [d.date.slice(0, 10), d.value]));
  return eachDay(start, end).map((d, i) => ({
    date:    d,
    current: curMap.get(d) ?? 0,
    compare: cmpMap.get(cmpDays[i] ?? '') ?? 0,
  }));
}

interface KpiDescriptor {
  key: string; label: string; value: string; title?: string;
  delta?: number | null; unit?: 'pct' | 'pt'; invert?: boolean; note?: string | undefined;
}

export default function ProductionReportPage(): JSX.Element {
  const period = useReportPeriod();
  const { start, end, compareRange } = period;

  const current = useProductionReport({ start, end });
  const compare = useProductionReport({ start: compareRange.start, end: compareRange.end });

  const data     = current.data;
  const prevData = compare.data;
  const showCompareSeries = period.compare && prevData !== undefined;

  // `?? []` rend un tableau NEUF à chaque render : posé tel quel en dépendance
  // d'un `useMemo`, il en casse la mémoïsation à chaque fois (c'est la classe de
  // bug R-01, où une dépendance instable relançait la requête en boucle).
  const byProduct = useMemo(() => data?.by_product ?? [], [data?.by_product]);
  const byDay     = useMemo(() => data?.by_day     ?? [], [data?.by_day]);
  const prevByDay = useMemo(() => prevData?.by_day ?? [], [prevData?.by_day]);
  const summary   = data?.summary;
  const prev      = prevData?.summary;

  const produced = summary?.total_produced ?? 0;
  const wasted   = summary?.total_waste    ?? 0;
  const wasteRate     = produced > 0 ? (wasted / produced) * 100 : null;
  const prevWasteRate = prev !== undefined && prev.total_produced > 0
    ? (prev.total_waste / prev.total_produced) * 100
    : null;

  const daily = useMemo(
    () => buildDaily(start, end, compareRange.start, compareRange.end, byDay, prevByDay),
    [start, end, compareRange.start, compareRange.end, byDay, prevByDay],
  );

  const ranked = useMemo(
    () => byProduct.slice().sort((a, b) => b.value - a.value),
    [byProduct],
  );
  const top = topSlice(ranked, (r) => r.value, 'value produced');
  const productRows: BreakdownRow[] = top.rows.map((r, i) => ({
    key: r.product_id || r.product_name,
    label: r.product_name,
    amount: r.value,
    sharePct: sharePct(r.value, top.total),
    color: categoricalColor(i),
    count: `${formatCount(r.qty_produced)} pcs`,
  }));

  const tiles: KpiDescriptor[] = [
    {
      key: 'value', label: 'Value produced',
      value: formatIdrCompact(summary?.total_value ?? 0),
      title: formatIdrFull(summary?.total_value ?? 0),
      delta: pctChange(summary?.total_value ?? 0, prev?.total_value),
      note:  `${formatCount(byProduct.length)} product${byProduct.length === 1 ? '' : 's'}`,
    },
    {
      key: 'runs', label: 'Production runs',
      value: formatCount(summary?.runs ?? 0),
      delta: pctChange(summary?.runs ?? 0, prev?.runs),
    },
    {
      key: 'produced', label: 'Qty produced',
      value: formatCount(produced),
      delta: pctChange(produced, prev?.total_produced),
    },
    {
      key: 'wasted', label: 'Qty wasted',
      value: formatCount(wasted),
      delta: pctChange(wasted, prev?.total_waste), invert: true,
    },
    {
      key: 'waste-rate', label: 'Waste ÷ produced',
      value: wasteRate === null ? '—' : formatPct1(wasteRate),
      delta: wasteRate !== null && prevWasteRate !== null ? wasteRate - prevWasteRate : null,
      unit:  'pt', invert: true,
    },
    {
      key: 'busiest', label: 'Busiest day',
      value: formatIdrCompact(
        byDay.reduce((m, d) => Math.max(m, d.value), 0),
      ),
      note: byDay.length === 0
        ? 'no production day'
        : shortDate(byDay.reduce((b, d) => (d.value > b.value ? d : b), byDay[0]!).date.slice(0, 10)),
    },
  ];

  const meta = [
    periodLabel(start, end),
    'produced quantities, waste and value per product',
  ].join(' · ');

  const toolbar = (
    <>
      <PeriodControl period={period} showCompare />
      <ExportMenu
        csv={{ rows: byProduct, columns: csvColumns, filename: `production-report-${start}_${end}` }}
        disabled={byProduct.length === 0}
      />
    </>
  );

  return (
    <ReportShell
      title="Production Report"
      subtitle={meta}
      breadcrumb={[{ label: 'Reports', to: '/backoffice/reports' }, { label: 'Inventory' }]}
      toolbar={toolbar}
      error={current.error}
      isEmpty={
        !current.isLoading && data !== undefined
        && byProduct.length === 0 && byDay.length === 0
      }
      emptyState={{
        title: 'No production',
        description: 'No production run recorded for this period.',
      }}
      kpis={
        <KpiBand isLoading={current.isLoading} tiles={tiles.length} labels={tiles.map((t) => t.label)}>
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
          title="Production value by day"
          subtitle="Value of the batches produced each day."
          isLoading={current.isLoading}
          testId="chart-production-by-day"
        >
          <PairedBarsChart
            data={daily}
            xKey="date"
            currentKey="current"
            currentName="This period"
            {...(showCompareSeries ? { compareKey: 'compare', compareName: 'Previous period' } : {})}
            xTickFormatter={(v) => shortDate(String(v))}
            ariaLabel={`Production value per day, current period compared with the previous one, ${start} to ${end}.`}
          />
        </PanelCard>

        <BreakdownCard
          title="By product"
          subtitle={top.note ?? 'Share of the value produced over the period.'}
          variant="track"
          rows={productRows}
          total={{ label: 'Total produced', amount: top.total }}
          isLoading={current.isLoading}
          emptyText="No production to ventilate for this period."
          testId="breakdown-production-products"
        />
      </div>

      <PanelCard
        title="Per product"
        className="mt-3"
        subtitle="Runs, quantities and value — the quantities the card does not carry."
        isLoading={current.isLoading}
        testId="production-by-product"
      >
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <caption className="sr-only">Runs, produced and wasted quantities and value per product</caption>
            <thead>
              <tr className="border-b border-border-subtle text-text-secondary">
                <th scope="col" className="py-2 text-left">Product</th>
                <th scope="col" className="py-2 text-right">Runs</th>
                <th scope="col" className="py-2 text-right">Qty produced</th>
                <th scope="col" className="py-2 text-right">Qty waste</th>
                <th scope="col" className="py-2 text-right">Value</th>
              </tr>
            </thead>
            <tbody>
              {ranked.map((r) => (
                <tr key={r.product_id} className="border-b border-border-subtle">
                  <td className="py-2 font-medium">
                    <DrilldownLink entity="product" id={r.product_id} label={r.product_name} icon={false} />
                  </td>
                  <td className={NUM_CELL}>{formatCount(r.runs)}</td>
                  <td className={NUM_CELL}>{formatCount(r.qty_produced)}</td>
                  <td className={NUM_CELL}>{formatCount(r.qty_waste)}</td>
                  <td className={NUM_CELL}>{formatIdrFull(r.value)}</td>
                </tr>
              ))}
            </tbody>
            {ranked.length > 0 && summary !== undefined && (
              <tfoot>
                <tr className="border-t border-border-subtle font-semibold">
                  <td className="py-2">Total</td>
                  <td className={NUM_CELL}>{formatCount(summary.runs)}</td>
                  <td className={NUM_CELL}>{formatCount(summary.total_produced)}</td>
                  <td className={NUM_CELL}>{formatCount(summary.total_waste)}</td>
                  <td className={NUM_CELL}>{formatIdrFull(summary.total_value)}</td>
                </tr>
              </tfoot>
            )}
          </table>
        </div>
      </PanelCard>

      <PanelCard
        title="Day by day"
        className="mt-3"
        subtitle="Quantities per day — the chart carries the value only."
        isLoading={current.isLoading}
        testId="production-by-day"
      >
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <caption className="sr-only">Produced and wasted quantities and value per day</caption>
            <thead>
              <tr className="border-b border-border-subtle text-text-secondary">
                <th scope="col" className="py-2 text-left">Date</th>
                <th scope="col" className="py-2 text-right">Qty produced</th>
                <th scope="col" className="py-2 text-right">Qty waste</th>
                <th scope="col" className="py-2 text-right">Value</th>
              </tr>
            </thead>
            <tbody>
              {byDay.map((d) => (
                <tr key={d.date} className="border-b border-border-subtle">
                  <td className="py-2 font-data text-xs text-text-secondary">{d.date.slice(0, 10)}</td>
                  <td className={NUM_CELL}>{formatCount(d.qty_produced)}</td>
                  <td className={NUM_CELL}>{formatCount(d.qty_waste)}</td>
                  <td className={NUM_CELL}>{formatIdrFull(d.value)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </PanelCard>
    </ReportShell>
  );
}
