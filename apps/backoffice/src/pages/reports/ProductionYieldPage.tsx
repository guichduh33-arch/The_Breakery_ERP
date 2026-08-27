// apps/backoffice/src/pages/reports/ProductionYieldPage.tsx
//
// Lot F (campagne Reports 2026-08-15) — vague Inventory, page 4/10. Migrée sur
// le socle Report shell v2 (archétype maquette 4c, patron : DailySalesPage).
//
// CE QUI NE CHANGE PAS, ET NE DOIT PAS :
//  · `production_records.yield_variance_pct` est un NUMERIC(7,4) stocké en
//    FRACTION (`-0.1667` = −16,67 %). Tout le calcul garde cette forme ; seule
//    la couche d'affichage multiplie par 100. L'écran voisin (Production
//    Efficiency) reçoit, lui, des POUR-CENT — les deux ne se recopient pas.
//  · les deux sections d'origine : top-10 des écarts en valeur ABSOLUE, puis
//    tendance par recette. Le « max |variance| » d'ici reste distinct du
//    « worst » signé de Production Efficiency (R-19), et les libellés le disent.
//  · le drill-down par ligne, ACCESSIBLE AU CLAVIER depuis le lot A2 : les
//    lignes sont focusables et répondent à Entrée/Espace. Ce correctif est
//    reconduit tel quel.
//  · la bannière de plafond serveur, et le fait que les deux sections sont
//    calculées sur ce seul sous-ensemble quand elle s'affiche.
//
// Ce qui change : l'ossature du socle (fil d'Ariane, bandeau, contrôle de
// période, menu d'export, bande de KPI, états de chargement/erreur/vide) prend
// la place des états réimplantés à la main.
//
// PAS DE COMPARAISON ici : la page lit des ÉCARTS À UNE CIBLE, pas un volume.
// « Le pire lot de la période » n'est pas la même grandeur d'une période à
// l'autre — la mettre en regard de celle d'avant comparerait deux lots
// différents, ce qui ne veut rien dire.
//
// Params URL : `start` / `end` — les bornes portaient déjà les noms du socle,
// aucun repli legacy n'est nécessaire.

import { useMemo, useState, type JSX } from 'react';
import type { CsvColumn } from '@breakery/domain';
import { formatPercent } from '@breakery/utils';
import { Button, cn } from '@breakery/ui';
import { PanelCard } from '@/components/PanelCard.js';
import { KpiTile, KPI_NOTE, KPI_NOTE_HERO } from '@/components/kpi/KpiTile.js';
import { ReportShell } from '@/features/reports/components/ReportShell.js';
import { KpiBand } from '@/features/reports/components/KpiBand.js';
import { PeriodControl } from '@/features/reports/components/PeriodControl.js';
import { ExportMenu } from '@/features/reports/components/ExportMenu.js';
import { DrilldownLink } from '@/features/reports/components/DrilldownLink.js';
import { useReportPeriod } from '@/features/reports/hooks/useReportPeriod.js';
import { formatCount, periodLabel } from '@/features/reports/utils/reportFigures.js';
import {
  useProductionYield, YIELD_ROW_CAP, type YieldRow,
} from '@/features/reports/hooks/useProductionYield.js';

/** Seuil de dérive « à regarder » — le même que la teinte rouge du tableau. */
const OUTLIER_THRESHOLD = 0.15;

/** L'entrée est une FRACTION (ex. −0,1667 = −16,67 %). Seuils : 15 % / 5 %. */
function varianceTone(frac: number | null): string {
  if (frac === null) return 'text-text-secondary';
  const abs = Math.abs(frac);
  if (abs > OUTLIER_THRESHOLD) return 'text-danger font-semibold';
  if (abs > 0.05) return 'text-warning';
  return 'text-success';
}

/**
 * Cellule « Reason » des deux tableaux — tronquée à 18 rem.
 *
 * Le motif du dépôt (WalletLedgerTable) veut qu'une troncature porte son
 * `title` : le motif de l'écart est la SEULE explication de la ligne, et
 * l'ellipsis le coupait sans aucun recours — ni survol, ni clic, ni export
 * visible depuis l'écran. La colonne CSV le porte déjà en entier, mais un
 * lecteur ne télécharge pas un fichier pour lire une phrase.
 */
const REASON_CELL = 'max-w-[18rem] truncate py-2 text-xs text-text-secondary';

/** Fraction → pourcentage signé (`+12.50%` / `-16.67%`). */
function formatVariancePct(frac: number | null): string {
  if (frac === null) return '—';
  return formatPercent(frac * 100, { digits: 2, signed: true });
}

const YIELD_CSV_COLUMNS: CsvColumn<YieldRow>[] = [
  { header: 'production_number',    accessor: (r) => r.production_number },
  { header: 'product_name',         accessor: (r) => r.product_name },
  { header: 'production_date',      accessor: (r) => r.production_date },
  { header: 'expected_yield_qty',   accessor: (r) => r.expected_yield_qty },
  { header: 'actual_yield_qty',     accessor: (r) => r.actual_yield_qty },
  { header: 'yield_variance_pct',   accessor: (r) => r.yield_variance_pct === null ? null : (r.yield_variance_pct * 100).toFixed(4) },
  { header: 'yield_variance_reason', accessor: (r) => r.yield_variance_reason },
];

interface TrendRow {
  product_id:   string;
  product_name: string;
  batches:      number;
  avg_pct:      number;
  max_abs_pct:  number;
}

function aggregateTrend(rows: YieldRow[]): TrendRow[] {
  const acc: Record<string, { name: string; sum: number; count: number; max: number }> = {};
  for (const r of rows) {
    if (r.yield_variance_pct === null) continue;
    const a = acc[r.product_id] ?? { name: r.product_name, sum: 0, count: 0, max: 0 };
    a.sum += r.yield_variance_pct;
    a.count += 1;
    const abs = Math.abs(r.yield_variance_pct);
    if (abs > a.max) a.max = abs;
    acc[r.product_id] = a;
  }
  return Object.entries(acc).map(([product_id, v]) => ({
    product_id,
    product_name: v.name,
    batches:      v.count,
    avg_pct:      v.count === 0 ? 0 : v.sum / v.count,
    max_abs_pct:  v.max,
  })).sort((a, b) => b.max_abs_pct - a.max_abs_pct);
}

function OutliersTable({
  rows, onSelectProduct, selectedProductId,
}: {
  rows: YieldRow[];
  onSelectProduct: (productId: string | null) => void;
  selectedProductId: string | null;
}): JSX.Element {
  if (rows.length === 0) {
    return <p className="py-2 text-xs text-text-muted">No yield-tracked batches in this range.</p>;
  }
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm">
        <caption className="sr-only">
          The ten batches whose yield deviated most from target, worst first
        </caption>
        <thead>
          <tr className="border-b border-border-subtle text-text-secondary">
            <th scope="col" className="py-2 text-left">Production #</th>
            <th scope="col" className="py-2 text-left">Product</th>
            <th scope="col" className="py-2 text-left">Date</th>
            <th scope="col" className="py-2 text-right">Expected</th>
            <th scope="col" className="py-2 text-right">Actual</th>
            <th scope="col" className="py-2 text-right">Variance %</th>
            <th scope="col" className="py-2 text-left">Reason</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => {
            const isSelected = selectedProductId === r.product_id;
            return (
              // Lot A2 — la ligne de drill-down interne n'était accessible
              // qu'à la souris : focusable + Entrée/Espace.
              // `aria-selected` n'est admis que dans une grille, un listbox ou
              // un onglet — sur la ligne d'un tableau simple, il est ignoré au
              // mieux, trompeur au pire. Rien ne le remplace ici : la ligne
              // n'est pas « sélectionnée », elle FILTRE le reste de la page, et
              // c'est `aria-pressed` sur un contrôle qui le dirait — la ligne
              // n'en est pas un. L'état reste porté par le fond et le libellé.
              <tr
                key={r.id}
                tabIndex={0}
                className={cn(
                  'cursor-pointer border-b border-border-subtle hover:bg-surface-4',
                  'focus-visible:outline focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-gold',
                  isSelected && 'bg-surface-4',
                )}
                onClick={() => onSelectProduct(isSelected ? null : r.product_id)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' || e.key === ' ') {
                    e.preventDefault();
                    onSelectProduct(isSelected ? null : r.product_id);
                  }
                }}
                aria-label={
                  isSelected
                    ? `Outlier ${r.production_number}, filtering by this product — activate to clear`
                    : `Outlier ${r.production_number}, activate to filter by this product`
                }
                data-testid="yield-outlier-row"
              >
                <td className="py-2 font-data text-xs">{r.production_number}</td>
                <td className="py-2" onClick={(e) => e.stopPropagation()}>
                  <DrilldownLink entity="product" id={r.product_id} label={r.product_name} icon={false} />
                </td>
                <td className="py-2 font-data text-xs">{r.production_date.slice(0, 10)}</td>
                <td className="py-2 text-right font-data tabular-nums">{r.expected_yield_qty?.toLocaleString('id-ID') ?? '—'}</td>
                <td className="py-2 text-right font-data tabular-nums">{r.actual_yield_qty?.toLocaleString('id-ID') ?? '—'}</td>
                <td className={cn('py-2 text-right font-data tabular-nums', varianceTone(r.yield_variance_pct))}>
                  {formatVariancePct(r.yield_variance_pct)}
                </td>
                <td className={REASON_CELL} title={r.yield_variance_reason ?? ''}>
                  {r.yield_variance_reason ?? '—'}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

function DrillDownPanel({ rows }: { rows: YieldRow[] }): JSX.Element {
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm">
        <caption className="sr-only">Every yield-tracked batch of the selected product</caption>
        <thead>
          <tr className="border-b border-border-subtle text-text-secondary">
            <th scope="col" className="py-2 text-left">Production #</th>
            <th scope="col" className="py-2 text-left">Date</th>
            <th scope="col" className="py-2 text-right">Expected</th>
            <th scope="col" className="py-2 text-right">Actual</th>
            <th scope="col" className="py-2 text-right">Variance %</th>
            <th scope="col" className="py-2 text-left">Reason</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.id} className="border-b border-border-subtle" data-testid="yield-drilldown-row">
              <td className="py-2 font-data text-xs">{r.production_number}</td>
              <td className="py-2 font-data text-xs">{r.production_date.slice(0, 10)}</td>
              <td className="py-2 text-right font-data tabular-nums">{r.expected_yield_qty?.toLocaleString('id-ID') ?? '—'}</td>
              <td className="py-2 text-right font-data tabular-nums">{r.actual_yield_qty?.toLocaleString('id-ID') ?? '—'}</td>
              <td className={cn('py-2 text-right font-data tabular-nums', varianceTone(r.yield_variance_pct))}>
                {formatVariancePct(r.yield_variance_pct)}
              </td>
              <td className={REASON_CELL} title={r.yield_variance_reason ?? ''}>
                {r.yield_variance_reason ?? '—'}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function TrendTable({ rows }: { rows: TrendRow[] }): JSX.Element {
  if (rows.length === 0) {
    return <p className="py-2 text-xs text-text-muted">No recipes with yield data in this range.</p>;
  }
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm">
        <caption className="sr-only">Batch count, average and largest yield swing per recipe</caption>
        <thead>
          <tr className="border-b border-border-subtle text-text-secondary">
            <th scope="col" className="py-2 text-left">Product</th>
            <th scope="col" className="py-2 text-right">Batches</th>
            <th scope="col" className="py-2 text-right">Avg variance %</th>
            {/* Audit R-19 — distinct du « worst » de Production Efficiency, qui
                est le minimum signé et non le maximum en valeur absolue. */}
            <th scope="col" className="py-2 text-right">Max |variance %| (largest swing)</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.product_id} className="border-b border-border-subtle">
              <td className="py-2">
                <DrilldownLink entity="recipe" id={r.product_id} label={r.product_name} icon={false} />
              </td>
              <td className="py-2 text-right font-data tabular-nums">{formatCount(r.batches)}</td>
              <td className={cn('py-2 text-right font-data tabular-nums', varianceTone(r.avg_pct))}>
                {formatVariancePct(r.avg_pct)}
              </td>
              <td className={cn('py-2 text-right font-data tabular-nums', varianceTone(r.max_abs_pct))}>
                {formatVariancePct(r.max_abs_pct).replace('+', '')}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

interface KpiDescriptor { key: string; label: string; value: string; note?: string | undefined }

export default function ProductionYieldPage(): JSX.Element {
  const period = useReportPeriod();
  const { start, end } = period;
  const [drillProductId, setDrillProductId] = useState<string | null>(null);
  const { data, isLoading, error } = useProductionYield(start, end);

  const allRows = useMemo(() => data?.rows ?? [], [data]);

  const yieldRows = useMemo(
    () => allRows.filter((r) => r.yield_variance_pct !== null),
    [allRows],
  );

  const outliers = useMemo(() => {
    const rows = [...yieldRows];
    rows.sort((a, b) => Math.abs(b.yield_variance_pct ?? 0) - Math.abs(a.yield_variance_pct ?? 0));
    return rows.slice(0, 10);
  }, [yieldRows]);

  const trend = useMemo(() => aggregateTrend(allRows), [allRows]);

  const drillRows = useMemo(() => {
    if (drillProductId === null) return [];
    return yieldRows
      .filter((r) => r.product_id === drillProductId)
      .sort((a, b) => b.production_date.localeCompare(a.production_date));
  }, [drillProductId, yieldRows]);

  const drillProductName =
    drillProductId === null
      ? null
      : (yieldRows.find((r) => r.product_id === drillProductId)?.product_name ?? null);

  const truncated = data?.truncated === true;

  // Moyenne simple des LOTS : ici chaque lot est une observation, il n'y a rien
  // à pondérer. `null` quand aucun lot ne porte la mesure — un zéro dirait
  // « rendement nominal », ce que personne n'a mesuré.
  const avgVariance = yieldRows.length === 0
    ? null
    : yieldRows.reduce((s, r) => s + (r.yield_variance_pct ?? 0), 0) / yieldRows.length;
  const largestSwing = yieldRows.reduce((m, r) => Math.max(m, Math.abs(r.yield_variance_pct ?? 0)), 0);
  const beyond = yieldRows.filter((r) => Math.abs(r.yield_variance_pct ?? 0) > OUTLIER_THRESHOLD).length;
  const withReason = yieldRows.filter((r) => r.yield_variance_reason !== null).length;

  const tiles: KpiDescriptor[] = [
    {
      key: 'avg-variance', label: 'Avg yield variance',
      value: formatVariancePct(avgVariance),
      note:  `across ${formatCount(yieldRows.length)} tracked batch${yieldRows.length === 1 ? '' : 'es'}`,
    },
    {
      key: 'batches', label: 'Batches in window',
      value: formatCount(allRows.length),
      note:  truncated ? `capped at ${formatCount(YIELD_ROW_CAP)}` : undefined,
    },
    {
      key: 'largest-swing', label: 'Largest swing',
      value: yieldRows.length === 0 ? '—' : formatVariancePct(largestSwing).replace('+', ''),
      note:  'absolute deviation from target',
    },
    {
      key: 'beyond', label: 'Beyond ±15%',
      value: formatCount(beyond),
      note:  'batches worth a look',
    },
    {
      key: 'recipes', label: 'Recipes tracked',
      value: formatCount(trend.length),
    },
    {
      key: 'explained', label: 'Variances explained',
      value: yieldRows.length === 0 ? '—' : `${Math.round((withReason / yieldRows.length) * 100)}%`,
      note:  `${formatCount(withReason)} of ${formatCount(yieldRows.length)} with a reason`,
    },
  ];

  // Audit R-13 — le template PDF `production_yield` existe dans le registre et
  // dans _shared/pdf-templates depuis S30, mais la page n'offrait qu'un CSV
  // maison : le template était inatteignable.
  const pdfRows = useMemo(() => yieldRows.map((r) => ({
    production_number: r.production_number,
    recipe_name:       r.product_name,
    expected_yield:    r.expected_yield_qty ?? 0,
    actual_yield:      r.actual_yield_qty ?? 0,
    variance_pct:      r.yield_variance_pct ?? 0, // ratio, comme attendu par le template
    status:            r.yield_variance_reason ?? '',
  })), [yieldRows]);

  const toolbar = (
    <>
      <PeriodControl period={period} />
      <ExportMenu
        csv={{ rows: yieldRows, columns: YIELD_CSV_COLUMNS, filename: `production-yield-${start}_to_${end}` }}
        pdf={{
          template: 'production_yield',
          data: pdfRows,
          period: { start, end },
          filename: `production-yield-${start}_to_${end}`,
        }}
        disabled={yieldRows.length === 0}
      />
    </>
  );

  return (
    <ReportShell
      title="Production Yield"
      subtitle={`${periodLabel(start, end)} · batch variance outliers and per-recipe trend`}
      breadcrumb={[{ label: 'Reports', to: '/backoffice/reports' }, { label: 'Inventory' }]}
      toolbar={toolbar}
      error={error}
      isEmpty={!isLoading && data !== undefined && allRows.length === 0}
      emptyState={{
        title: 'No production batches',
        description: 'No production batch recorded in the selected window.',
      }}
      kpis={
        <KpiBand isLoading={isLoading} tiles={tiles.length} labels={tiles.map((t) => t.label)}>
          {tiles.map((t, i) => (
            <KpiTile key={t.key} label={t.label} value={t.value} hero={i === 0} testId={`kpi-${t.key}`}>
              {t.note !== undefined && (
                <span className={i === 0 ? KPI_NOTE_HERO : KPI_NOTE}>{t.note}</span>
              )}
            </KpiTile>
          ))}
        </KpiBand>
      }
    >
      {truncated && (
        <p
          className="rounded-sm border border-warning bg-warning-soft px-4 py-2 text-sm text-warning"
          role="status"
          data-testid="yield-truncated-banner"
        >
          First {YIELD_ROW_CAP} batches shown — outliers and per-recipe trend are
          computed on this subset only. Narrow the date range for a complete picture.
        </p>
      )}

      <PanelCard
        title="Top-10 variance outliers"
        className="mt-3"
        subtitle="Largest absolute deviation from the expected yield. Pick a row to open every batch of that product."
        isLoading={isLoading}
        testId="yield-outliers"
      >
        <OutliersTable
          rows={outliers}
          onSelectProduct={setDrillProductId}
          selectedProductId={drillProductId}
        />
      </PanelCard>

      {drillProductId !== null && (
        <PanelCard
          title={`Drill-down · ${drillProductName ?? drillProductId}`}
          className="mt-3"
          aside={
            <Button type="button" variant="ghost" size="sm" onClick={() => setDrillProductId(null)}>
              Clear
            </Button>
          }
          testId="yield-drilldown-section"
        >
          <DrillDownPanel rows={drillRows} />
        </PanelCard>
      )}

      <PanelCard
        title="Trend per recipe"
        className="mt-3"
        subtitle="Average and largest swing per recipe over the window."
        isLoading={isLoading}
        testId="yield-trend"
      >
        <TrendTable rows={trend} />
      </PanelCard>
    </ReportShell>
  );
}
