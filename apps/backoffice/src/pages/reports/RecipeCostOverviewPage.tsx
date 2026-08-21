// apps/backoffice/src/pages/reports/RecipeCostOverviewPage.tsx
//
// Lot F (campagne Reports 2026-08-15) — vague Inventory, page 5/10. Migrée sur
// le socle Report shell v2 (archétype maquette 4c, patron : DailySalesPage).
//
// CE QUI NE CHANGE PAS : la page consomme `useRecipeCostOverview` (lot A1, qui
// a extrait le `useQuery` inline des deux pages RecipeCost*) en mode overview de
// `recipe_cost_history_v1` — une ligne par produit, avec son delta sur la
// fenêtre. Le tri par |delta_pct| DESC (décision D7), les seuils de teinte
// (20 % / 5 %) et la navigation par ligne vers la timeline sont conservés, y
// compris son ACCESSIBILITÉ AU CLAVIER (lot A2 : lignes focusables, Entrée,
// destination annoncée).
//
// Ce qui change : l'ossature du socle prend la place du `ReportPage` et des
// états réimplantés — le chargement, l'erreur et le vide passent par la coque,
// et l'export par le menu unique.
//
// PAS DE COMPARAISON : le `delta_pct` servi EST déjà une comparaison — la
// variation du coût sur la fenêtre. Superposer une seconde fenêtre reviendrait
// à comparer deux comparaisons, ce qu'aucune phrase ne décrit.
//
// PAS DE GRAPHE : la lecture est un CLASSEMENT de dérives dont chaque ligne
// mène à sa propre chronologie ; le graphe de la série vit là-bas, par recette,
// où il a un axe qui veut dire quelque chose.
//
// Params URL : `start` / `end` — les bornes portaient déjà les noms du socle,
// aucun repli legacy n'est nécessaire.

import { useMemo, type JSX } from 'react';
import { useNavigate } from 'react-router-dom';
import { toLocalDateStr, type CsvColumn } from '@breakery/domain';
import { cn } from '@breakery/ui';
import { formatPercent } from '@breakery/utils';
import { PanelCard } from '@/components/PanelCard.js';
import { KpiTile, KPI_NOTE, KPI_NOTE_HERO } from '@/components/kpi/KpiTile.js';
import { ReportShell } from '@/features/reports/components/ReportShell.js';
import { KpiBand } from '@/features/reports/components/KpiBand.js';
import { PeriodControl } from '@/features/reports/components/PeriodControl.js';
import { ExportMenu } from '@/features/reports/components/ExportMenu.js';
import { DrilldownLink } from '@/features/reports/components/DrilldownLink.js';
import { useReportPeriod } from '@/features/reports/hooks/useReportPeriod.js';
import { formatIdrPrecise } from '@/features/reports/utils/chartColors.js';
import { formatCount, periodLabel } from '@/features/reports/utils/reportFigures.js';
import {
  useRecipeCostOverview, type RecipeCostOverviewRow as OverviewRow,
} from '@/features/reports/hooks/useRecipeCostHistory.js';

const NUM_CELL = 'py-1.5 text-right font-data tabular-nums';

/** Teinte du delta — les seuils sont des POINTS de pourcentage, pas des
 *  fractions. */
function deltaTone(d: number | null): string {
  if (d === null) return 'text-text-secondary';
  const abs = Math.abs(d);
  if (abs > 20) return 'text-danger font-semibold';
  if (abs > 5)  return 'text-warning';
  return 'text-success';
}

function formatDeltaPct(d: number | null): string {
  if (d === null) return '—';
  return formatPercent(d, { digits: 2, signed: true });
}

const OVERVIEW_CSV_COLUMNS: CsvColumn<OverviewRow>[] = [
  { header: 'product_name',   accessor: (r) => r.product_name },
  { header: 'current_cost',   accessor: (r) => r.cost_per_unit },
  { header: 'baseline_cost',  accessor: (r) => r.baseline_cost },
  { header: 'delta_pct',      accessor: (r) => r.delta_pct === null ? null : r.delta_pct.toFixed(2) },
  { header: 'change_count',   accessor: (r) => r.change_count },
  { header: 'last_change_date', accessor: (r) => r.created_at ?? '' },
];

interface KpiDescriptor { key: string; label: string; value: string; note?: string | undefined }

/** L'extrême d'un côté du mouvement — `undefined` quand personne n'a bougé dans
 *  ce sens. Un « plus fort hausse » de 0 % n'existe pas. */
function extreme(rows: OverviewRow[], direction: 1 | -1): OverviewRow | undefined {
  return rows.reduce<OverviewRow | undefined>((best, r) => {
    if (r.delta_pct === null || r.delta_pct * direction <= 0) return best;
    if (best?.delta_pct == null) return r;
    return r.delta_pct * direction > best.delta_pct * direction ? r : best;
  }, undefined);
}

export function RecipeCostOverviewPage(): JSX.Element {
  const navigate = useNavigate();
  const period = useReportPeriod();
  const { start, end } = period;

  const q = useRecipeCostOverview(start, end);

  /** Tri par |delta_pct| DESC (D7). Deltas non nuls d'abord ; NULL en fin. */
  const rows = useMemo<OverviewRow[]>(() => {
    const list = q.data ?? [];
    return [...list].sort((a, b) => {
      const da = a.delta_pct === null ? -Infinity : Math.abs(a.delta_pct);
      const db = b.delta_pct === null ? -Infinity : Math.abs(b.delta_pct);
      return db - da;
    });
  }, [q.data]);

  const up   = rows.filter((r) => r.delta_pct !== null && r.delta_pct > 0);
  const down = rows.filter((r) => r.delta_pct !== null && r.delta_pct < 0);
  const biggestUp   = extreme(rows, 1);
  const biggestDown = extreme(rows, -1);
  const changes = rows.reduce((s, r) => s + r.change_count, 0);

  const tiles: KpiDescriptor[] = [
    {
      key: 'recipes', label: 'Recipes tracked',
      value: formatCount(rows.length),
      note:  'with cost history in the window',
    },
    {
      key: 'up', label: 'Costs up',
      value: formatCount(up.length),
      note:  rows.length > 0 ? `of ${formatCount(rows.length)} recipes` : undefined,
    },
    {
      key: 'down', label: 'Costs down',
      value: formatCount(down.length),
      note:  rows.length > 0 ? `of ${formatCount(rows.length)} recipes` : undefined,
    },
    {
      key: 'biggest-up', label: 'Biggest rise',
      value: formatDeltaPct(biggestUp?.delta_pct ?? null),
      note:  biggestUp?.product_name ?? 'no recipe went up',
    },
    {
      key: 'biggest-down', label: 'Biggest drop',
      value: formatDeltaPct(biggestDown?.delta_pct ?? null),
      note:  biggestDown?.product_name ?? 'no recipe went down',
    },
    {
      key: 'changes', label: 'Version changes',
      value: formatCount(changes),
      note:  'recipe revisions booked',
    },
  ];

  // Audit R-13 — le template PDF `recipe_overview` était construit mais
  // inatteignable : la page n'exposait qu'un CSV maison.
  const pdfRows = useMemo(() => rows.map((r) => ({
    product_name:  r.product_name,
    cost_per_unit: r.cost_per_unit ?? 0,
    baseline_cost: r.baseline_cost,
    delta_pct:     r.delta_pct,
    change_count:  r.change_count,
    created_at:    r.created_at,
  })), [rows]);

  const toolbar = (
    <>
      <PeriodControl period={period} />
      <ExportMenu
        csv={{ rows, columns: OVERVIEW_CSV_COLUMNS, filename: `recipe-cost-overview-${start}_${end}` }}
        pdf={{
          template: 'recipe_overview',
          data: pdfRows,
          period: { start, end },
          filename: `recipe-cost-overview-${start}_${end}`,
        }}
        disabled={rows.length === 0}
      />
    </>
  );

  const openTimeline = (productId: string): void => {
    void navigate(`/backoffice/reports/recipe-cost/${productId}`);
  };

  return (
    <ReportShell
      title="Recipe Cost Overview"
      subtitle={`${periodLabel(start, end)} · cost movement per recipe — open a row for its full version timeline`}
      breadcrumb={[{ label: 'Reports', to: '/backoffice/reports' }, { label: 'Inventory' }]}
      toolbar={toolbar}
      error={q.error}
      isEmpty={!q.isLoading && q.error == null && rows.length === 0}
      emptyState={{
        title: 'No cost movement',
        description: 'No recipe cost movement in the selected window.',
        'data-testid': 'empty-overview',
      }}
      kpis={
        <KpiBand isLoading={q.isLoading} tiles={tiles.length} labels={tiles.map((t) => t.label)}>
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
      <PanelCard
        title="Cost movement by recipe"
        subtitle="Sorted by the size of the move, whichever way it went."
        isLoading={q.isLoading}
        testId="recipe-cost-overview"
      >
        <div className="overflow-x-auto">
          <table className="w-full text-sm" data-testid="overview-table">
            <caption className="sr-only">
              Current cost, baseline, movement, revision count and last change date per recipe
            </caption>
            <thead>
              <tr className="border-b border-border-subtle text-text-secondary">
                <th scope="col" className="py-2 text-left">Product</th>
                <th scope="col" className="py-2 text-right">Current</th>
                <th scope="col" className="py-2 text-right">Baseline</th>
                <th scope="col" className="py-2 text-right">Δ %</th>
                <th scope="col" className="py-2 text-right">Changes</th>
                <th scope="col" className="py-2 text-right">Last change</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                // Lot A2 — la navigation par ligne n'était accessible qu'à la
                // souris : focusable + Entrée, destination annoncée.
                <tr
                  key={r.product_id}
                  tabIndex={0}
                  aria-label={`Open cost timeline for ${r.product_name}`}
                  className={cn(
                    'cursor-pointer border-t border-border-subtle hover:bg-surface-4',
                    'focus-visible:outline focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-gold',
                  )}
                  data-testid={`overview-row-${r.product_id}`}
                  onClick={() => openTimeline(r.product_id)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') {
                      e.preventDefault();
                      openTimeline(r.product_id);
                    }
                  }}
                >
                  <td className="py-1.5" onClick={(e) => e.stopPropagation()}>
                    <DrilldownLink entity="recipe" id={r.product_id} label={r.product_name} icon={false} />
                  </td>
                  <td className={NUM_CELL}>
                    {r.cost_per_unit !== null ? formatIdrPrecise(r.cost_per_unit) : '—'}
                  </td>
                  <td className={NUM_CELL}>
                    {r.baseline_cost !== null ? formatIdrPrecise(r.baseline_cost) : '—'}
                  </td>
                  <td className={cn(NUM_CELL, deltaTone(r.delta_pct))}>
                    {formatDeltaPct(r.delta_pct)}
                  </td>
                  <td className={NUM_CELL}>{formatCount(r.change_count)}</td>
                  <td className={cn(NUM_CELL, 'text-text-secondary')}>
                    {r.created_at !== null ? toLocalDateStr(r.created_at) : '—'}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </PanelCard>
    </ReportShell>
  );
}

export default RecipeCostOverviewPage;
