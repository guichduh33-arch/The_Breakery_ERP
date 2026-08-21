// apps/backoffice/src/pages/reports/ProductionEfficiencyPage.tsx
//
// Lot F (campagne Reports 2026-08-15) — vague Inventory, page 2/10. Migrée sur
// le socle Report shell v2 (archétype maquette 4c, patron : DailySalesPage).
//
// CE QUI NE CHANGE PAS : tous les taux viennent de
// `get_production_efficiency_v1` et sont servis tels quels. Ils sont DÉJÀ en
// POUR-CENT (`-5.2` = −5,2 %), contrairement à `production_records.
// yield_variance_pct` qui est une fraction — les deux écrans voisins n'ont pas
// la même unité, et rien ici ne convertit. La distinction « worst » (minimum
// SIGNÉ ici, maximum en valeur absolue dans Production Yield) reste nommée dans
// les en-têtes, comme au correctif R-19.
//
// Ce qui change :
//  1. LE « DAILY TREND » DEVIENT UN GRAPHE. Une série temporelle en table se lit
//     ligne à ligne ; sa forme — le décrochage d'un mardi, une dérive lente —
//     n'apparaît qu'en courbe.
//     Un jour sans production n'y vaut PAS zéro : un taux non mesuré n'est pas
//     un taux nul, la ligne s'y interrompt (`undefined`, pas `0`), sans quoi le
//     graphe affirmerait un rendement parfait les jours de fermeture.
//  2. La table journalière est CONSERVÉE sous le graphe, comme bloc de détail :
//     elle porte le TAUX DE PERTE par jour, que la courbe ne trace pas — la
//     retirer perdrait une donnée que la page servait déjà. Même arbitrage que
//     la table « Day by day » de DailySalesPage.
//  3. La comparaison est méritée : chaque tuile porte sa variation contre la
//     période précédente. Les taux se comparent en POINTS (`unit: 'pt'`), jamais
//     en pour-cent d'un pour-cent.
//
// Les moyennes de période sont PONDÉRÉES PAR LES LOTS (`runs`) : la RPC ne sert
// pas de résumé, et une moyenne de moyennes donnerait le même poids à un produit
// lancé une fois qu'à un produit lancé quarante fois.
//
// Params URL : `start` / `end` / `cmp` — les bornes portaient déjà les noms du
// socle, aucun repli legacy n'est nécessaire.

import { useMemo, type JSX } from 'react';
import { cn } from '@breakery/ui';
import { formatPercent } from '@breakery/utils';
import type { CsvColumn } from '@breakery/domain';
import { PanelCard } from '@/components/PanelCard.js';
import { KpiTile, KPI_NOTE, KPI_NOTE_HERO } from '@/components/kpi/KpiTile.js';
import { Delta } from '@/components/kpi/Delta.js';
import { ReportShell } from '@/features/reports/components/ReportShell.js';
import { KpiBand } from '@/features/reports/components/KpiBand.js';
import { PeriodControl } from '@/features/reports/components/PeriodControl.js';
import { ExportMenu } from '@/features/reports/components/ExportMenu.js';
import { TrendLineChart } from '@/features/reports/components/charts/TrendLineChart.js';
import { DrilldownLink } from '@/features/reports/components/DrilldownLink.js';
import { useReportPeriod } from '@/features/reports/hooks/useReportPeriod.js';
import {
  eachDay, formatCount, periodLabel, pctChange, shortDate,
} from '@/features/reports/utils/reportFigures.js';
import {
  useProductionEfficiency,
  type ProductionEfficiencyByProduct,
  type ProductionEfficiencyData,
} from '@/features/reports/hooks/useProductionEfficiency.js';

const csvColumns: CsvColumn<ProductionEfficiencyByProduct>[] = [
  { header: 'Product',                    accessor: (r) => r.product_name,            format: 'text' },
  { header: 'Runs',                       accessor: (r) => r.runs,                    format: 'number' },
  { header: 'Avg Yield Variance (%)',     accessor: (r) => r.avg_yield_variance_pct ?? '', format: 'text' },
  { header: 'Worst Variance, most negative (%)', accessor: (r) => r.worst_variance_pct ?? '', format: 'text' },
  { header: 'Waste Rate (%)',             accessor: (r) => r.waste_rate_pct ?? '',          format: 'text' },
  { header: 'Has Variance Reasons',       accessor: (r) => r.has_variance_reasons ? 'Yes' : 'No', format: 'text' },
];

const NUM_CELL = 'py-2 text-right font-data tabular-nums';

/** Teinte d'un écart de rendement (en POUR-CENT).
 *  < −10 → rouge (sous-performance), ≥ 0 → vert, sinon neutre. */
function varianceClass(pct: number | null): string {
  if (pct === null) return 'text-text-secondary';
  if (pct < -10)   return 'text-danger font-medium';
  if (pct >= 0)    return 'text-success font-medium';
  return 'text-text-primary';
}

function fmtPct(pct: number | null): string {
  if (pct === null) return '—';
  return formatPercent(pct, { signed: true });
}

function fmtRate(pct: number | null): string {
  return formatPercent(pct);
}

/**
 * Moyenne pondérée par le nombre de lots, sur les seuls produits qui portent la
 * mesure. `null` quand personne ne la porte — une absence de mesure n'est pas
 * un zéro, et l'afficher comme tel dirait « rendement nominal ».
 */
function weightedMean(
  rows: ProductionEfficiencyByProduct[],
  pick: (r: ProductionEfficiencyByProduct) => number | null,
): number | null {
  let sum = 0;
  let weight = 0;
  for (const r of rows) {
    const v = pick(r);
    if (v === null || r.runs <= 0) continue;
    sum += v * r.runs;
    weight += r.runs;
  }
  return weight === 0 ? null : sum / weight;
}

/** Somme des lots de la période. */
function totalRuns(rows: ProductionEfficiencyByProduct[]): number {
  return rows.reduce((s, r) => s + r.runs, 0);
}

/** Le produit au plus mauvais écart SIGNÉ — la définition « worst » de cet
 *  écran, distincte de celle de Production Yield (R-19). */
function worstProduct(
  rows: ProductionEfficiencyByProduct[],
): ProductionEfficiencyByProduct | undefined {
  return rows.reduce<ProductionEfficiencyByProduct | undefined>((worst, r) => {
    if (r.worst_variance_pct === null) return worst;
    if (worst?.worst_variance_pct == null) return r;
    return r.worst_variance_pct < worst.worst_variance_pct ? r : worst;
  }, undefined);
}

/** Part des produits dont au moins un écart est motivé — une qualité de saisie,
 *  pas une performance. */
function documentedShare(rows: ProductionEfficiencyByProduct[]): number | null {
  if (rows.length === 0) return null;
  return (rows.filter((r) => r.has_variance_reasons).length / rows.length) * 100;
}

/** Écart en POINTS entre deux taux, `null` dès qu'un des deux manque. */
function pointDelta(current: number | null, previous: number | null | undefined): number | null {
  if (current === null || previous === null || previous === undefined) return null;
  return current - previous;
}

interface KpiDescriptor {
  key: string; label: string; value: string;
  delta?: number | null; unit?: 'pct' | 'pt'; invert?: boolean; note?: string | undefined;
}

/** Point du graphe : le taux peut MANQUER, et il manque en `undefined`. */
interface TrendPoint {
  date:     string;
  current?: number;
  compare?: number;
  [k: string]: string | number | undefined;
}

function buildTrend(
  start: string, end: string,
  cmpStart: string, cmpEnd: string,
  cur: ProductionEfficiencyData | undefined,
  prev: ProductionEfficiencyData | undefined,
): TrendPoint[] {
  const cmpDays = eachDay(cmpStart, cmpEnd);
  const curMap = new Map(
    (cur?.by_day ?? [])
      .filter((d) => d.avg_yield_variance_pct !== null)
      .map((d) => [d.date.slice(0, 10), d.avg_yield_variance_pct!]),
  );
  const cmpMap = new Map(
    (prev?.by_day ?? [])
      .filter((d) => d.avg_yield_variance_pct !== null)
      .map((d) => [d.date.slice(0, 10), d.avg_yield_variance_pct!]),
  );
  // La comparaison s'aligne par RANG dans sa propre fenêtre : le 3ᵉ jour de la
  // période courante face au 3ᵉ jour de la précédente.
  return eachDay(start, end).map((d, i) => {
    const point: TrendPoint = { date: d };
    const c = curMap.get(d);
    if (c !== undefined) point.current = c;
    const p = cmpMap.get(cmpDays[i] ?? '');
    if (p !== undefined) point.compare = p;
    return point;
  });
}

export default function ProductionEfficiencyPage(): JSX.Element {
  const period = useReportPeriod();
  const { start, end, compareRange } = period;

  const current = useProductionEfficiency({ start, end });
  const compare = useProductionEfficiency({ start: compareRange.start, end: compareRange.end });

  const data     = current.data;
  const prevData = compare.data;
  const showCompareSeries = period.compare && prevData !== undefined;

  const byProduct = data?.by_product ?? [];
  const byDay     = data?.by_day     ?? [];
  const prevProducts = prevData?.by_product ?? [];

  const avgVariance     = weightedMean(byProduct, (r) => r.avg_yield_variance_pct);
  const avgWasteRate    = weightedMean(byProduct, (r) => r.waste_rate_pct);
  const prevVariance    = prevData !== undefined ? weightedMean(prevProducts, (r) => r.avg_yield_variance_pct) : undefined;
  const prevWasteRate   = prevData !== undefined ? weightedMean(prevProducts, (r) => r.waste_rate_pct) : undefined;
  const runs            = totalRuns(byProduct);
  const prevRuns        = prevData !== undefined ? totalRuns(prevProducts) : undefined;
  const worst           = worstProduct(byProduct);
  const documented      = documentedShare(byProduct);
  const prevDocumented  = prevData !== undefined ? documentedShare(prevProducts) : undefined;

  const trend = useMemo(
    () => buildTrend(start, end, compareRange.start, compareRange.end, data, prevData),
    [start, end, compareRange.start, compareRange.end, data, prevData],
  );

  const tiles: KpiDescriptor[] = [
    {
      // Un rendement qui MONTE est une bonne nouvelle : pas d'`invert`.
      key: 'avg-variance', label: 'Avg yield variance',
      value: fmtPct(avgVariance),
      delta: pointDelta(avgVariance, prevVariance), unit: 'pt',
      note:  `weighted by ${formatCount(runs)} run${runs === 1 ? '' : 's'}`,
    },
    {
      key: 'waste-rate', label: 'Avg waste rate',
      value: fmtRate(avgWasteRate),
      delta: pointDelta(avgWasteRate, prevWasteRate), unit: 'pt', invert: true,
    },
    {
      key: 'runs', label: 'Production runs',
      value: formatCount(runs),
      delta: pctChange(runs, prevRuns),
    },
    {
      key: 'products', label: 'Products tracked',
      value: formatCount(byProduct.length),
      delta: pctChange(byProduct.length, prevData !== undefined ? prevProducts.length : undefined),
    },
    {
      // D'une période à l'autre ce n'est pas le même produit : aucune variation
      // ne peut se rapporter à cette tuile sans comparer deux choses distinctes.
      key: 'worst', label: 'Worst run (signed)',
      value: fmtPct(worst?.worst_variance_pct ?? null),
      note:  worst?.product_name ?? 'no variance recorded',
    },
    {
      key: 'documented', label: 'Variances explained',
      value: formatPercent(documented, { digits: 0 }),
      delta: pointDelta(documented, prevDocumented), unit: 'pt',
      note:  'products with a stated reason',
    },
  ];

  const meta = [
    periodLabel(start, end),
    'yield variance and waste rate per product',
  ].join(' · ');

  const toolbar = (
    <>
      <PeriodControl period={period} showCompare />
      <ExportMenu
        csv={{ rows: byProduct, columns: csvColumns, filename: `production-efficiency-${start}_${end}` }}
        disabled={byProduct.length === 0}
      />
    </>
  );

  return (
    <ReportShell
      title="Production Efficiency"
      subtitle={meta}
      breadcrumb={[{ label: 'Reports', to: '/backoffice/reports' }, { label: 'Inventory' }]}
      toolbar={toolbar}
      error={current.error}
      isEmpty={
        !current.isLoading && data !== undefined
        && byProduct.length === 0 && byDay.length === 0
      }
      emptyState={{
        title: 'No production data',
        description: 'No production efficiency data for this period.',
      }}
      kpis={
        <KpiBand isLoading={current.isLoading} tiles={tiles.length} labels={tiles.map((t) => t.label)}>
          {tiles.map((t, i) => (
            <KpiTile key={t.key} label={t.label} value={t.value} hero={i === 0} testId={`kpi-${t.key}`}>
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
      <PanelCard
        title="Yield variance by day"
        subtitle="Average yield variance per production day. A gap is a day without a measured run — not a perfect one."
        isLoading={current.isLoading}
        testId="chart-yield-trend"
      >
        <TrendLineChart
          data={trend}
          xKey="date"
          currentKey="current"
          currentName="This period"
          {...(showCompareSeries ? { compareKey: 'compare', compareName: 'Previous period' } : {})}
          xTickFormatter={(v) => shortDate(String(v))}
          yTickFormatter={(v) => formatPercent(v, { digits: 0 })}
          valueFormatter={(v) => formatPercent(v, { signed: true })}
          ariaLabel={`Average yield variance per day in percent, ${start} to ${end}.`}
        />
      </PanelCard>

      <PanelCard
        title="By product"
        className="mt-3"
        subtitle="Yield variance and waste rate per product over the window."
        isLoading={current.isLoading}
        testId="efficiency-by-product"
      >
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <caption className="sr-only">
              Runs, average and worst yield variance, waste rate and reason coverage per product
            </caption>
            <thead>
              <tr className="border-b border-border-subtle text-text-secondary">
                <th scope="col" className="py-2 text-left">Product</th>
                <th scope="col" className="py-2 text-right">Runs</th>
                <th scope="col" className="py-2 text-right">Avg yield var.</th>
                {/* Audit R-19 — « worst » désigne MIN(variance) ici et
                    MAX(|variance|) dans Production Yield. Les deux calculs
                    restent légitimes ; les libellés les distinguent. */}
                <th scope="col" className="py-2 text-right">Worst (most negative)</th>
                <th scope="col" className="py-2 text-right">Waste rate</th>
                <th scope="col" className="py-2 text-center">Reasons</th>
              </tr>
            </thead>
            <tbody>
              {byProduct.map((r) => (
                <tr key={r.product_id} className="border-b border-border-subtle">
                  <td className="py-2 font-medium">
                    <DrilldownLink entity="product" id={r.product_id} label={r.product_name} icon={false} />
                  </td>
                  <td className={NUM_CELL}>{formatCount(r.runs)}</td>
                  <td className={cn(NUM_CELL, varianceClass(r.avg_yield_variance_pct))}>
                    {fmtPct(r.avg_yield_variance_pct)}
                  </td>
                  <td className={cn(NUM_CELL, varianceClass(r.worst_variance_pct))}>
                    {fmtPct(r.worst_variance_pct)}
                  </td>
                  <td className={cn(NUM_CELL, 'text-text-secondary')}>{fmtRate(r.waste_rate_pct)}</td>
                  <td className="py-2 text-center text-text-secondary">
                    {r.has_variance_reasons ? 'Yes' : '—'}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </PanelCard>

      {/* Bloc de détail conservé : la courbe ne trace que l'écart de rendement,
          et le TAUX DE PERTE journalier n'apparaîtrait alors nulle part. */}
      <PanelCard
        title="Day by day"
        className="mt-3"
        subtitle="Both rates per day — the waste rate is not on the chart."
        isLoading={current.isLoading}
        testId="efficiency-by-day"
      >
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <caption className="sr-only">Average yield variance and waste rate per day</caption>
            <thead>
              <tr className="border-b border-border-subtle text-text-secondary">
                <th scope="col" className="py-2 text-left">Date</th>
                <th scope="col" className="py-2 text-right">Avg yield var.</th>
                <th scope="col" className="py-2 text-right">Waste rate</th>
              </tr>
            </thead>
            <tbody>
              {byDay.map((d) => (
                <tr key={d.date} className="border-b border-border-subtle">
                  <td className="py-2 font-data text-xs text-text-secondary">{d.date.slice(0, 10)}</td>
                  <td className={cn(NUM_CELL, varianceClass(d.avg_yield_variance_pct))}>
                    {fmtPct(d.avg_yield_variance_pct)}
                  </td>
                  <td className={cn(NUM_CELL, 'text-text-secondary')}>{fmtRate(d.waste_rate_pct)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </PanelCard>
    </ReportShell>
  );
}
