// apps/backoffice/src/pages/reports/RecipeCostTimelinePage.tsx
//
// Lot F (campagne Reports 2026-08-15) — vague Inventory, page 6/10. Migrée sur
// le socle Report shell v2 (archétype maquette 4c, patron : DailySalesPage).
//
// SA SÉMANTIQUE EST CONSERVÉE, ET ELLE EST PARTICULIÈRE : l'axe des abscisses
// ne porte pas des JOURS mais des VERSIONS DE RECETTE — une poignée
// d'événements datés, pas un échantillonnage régulier. D'où :
//  · le graphe garde ses POINTS (`dots`, extension additive du socle) : chaque
//    point EST un fait, et sans marqueur on ne sait plus où la mesure a eu lieu ;
//  · aucune journée n'est comblée : entre deux versions il ne s'est rien passé,
//    et une valeur intermédiaire n'existe pas ;
//  · le `Δ vs prev` de la table se calcule VERSION À VERSION, jamais contre une
//    période — c'est la lecture d'une chronologie, pas d'une fenêtre.
//
// Conservé aussi : le fuseau métier sur `created_at` (correctif R-20 — un
// `slice(0,10)` affichait la date UTC comme si elle était locale, et une version
// créée à 01:00 à Makassar apparaissait la veille), les coûts unitaires en
// précision sous-roupie (`formatIdrPrecise` — arrondir à l'entier effacerait
// l'information sur un coût au gramme), le lien de retour, et les deux exports.
//
// Lot B avait déjà retiré l'or de la courbe (l'or est une encre de sens, jamais
// une série) ; elle passe ici sur le composant de tendance du socle, qui porte
// la même couleur et les mêmes axes que les autres graphes du module.
//
// Params URL : `from` / `to` deviennent `start` / `end` (repli legacy posé — les
// liens copiés avant l'unification restent honorés). La fenêtre par défaut de
// 90 jours cède au défaut unique du socle : c'est précisément la divergence de
// défauts (29 j / 6 j / 89 j) que `useReportPeriod` abolit, et la période suit
// désormais la navigation inter-rapports.

import { useMemo, type JSX } from 'react';
import { useParams, Link } from 'react-router-dom';
import { toLocalDateStr, DEFAULT_TIMEZONE, type CsvColumn } from '@breakery/domain';
import { cn } from '@breakery/ui';
import { formatPercent } from '@breakery/utils';
import { PanelCard } from '@/components/PanelCard.js';
import { KpiTile, KPI_NOTE, KPI_NOTE_HERO } from '@/components/kpi/KpiTile.js';
import { ReportShell } from '@/features/reports/components/ReportShell.js';
import { KpiBand } from '@/features/reports/components/KpiBand.js';
import { PeriodControl } from '@/features/reports/components/PeriodControl.js';
import { ExportMenu } from '@/features/reports/components/ExportMenu.js';
import { TrendLineChart } from '@/features/reports/components/charts/TrendLineChart.js';
import { useReportPeriod } from '@/features/reports/hooks/useReportPeriod.js';
import { formatIdrCompact, formatIdrPrecise } from '@/features/reports/utils/chartColors.js';
import { formatCount, periodLabel } from '@/features/reports/utils/reportFigures.js';
import {
  useRecipeCostTimeline, type RecipeCostTimelineRow as TimelineRow,
} from '@/features/reports/hooks/useRecipeCostHistory.js';

interface TimelineRowWithDelta extends TimelineRow {
  delta_pct: number | null;
}

const NUM_CELL = 'py-1.5 text-right font-data tabular-nums';

/** Teinte du delta — les seuils sont des POINTS de pourcentage. */
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

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

const TIMELINE_CSV_COLUMNS: CsvColumn<TimelineRowWithDelta>[] = [
  { header: 'version_number',    accessor: (r) => r.version_number },
  { header: 'created_at',        accessor: (r) => r.created_at },
  { header: 'cost_per_unit',     accessor: (r) => r.cost_per_unit },
  { header: 'delta_vs_prev_pct', accessor: (r) => r.delta_pct !== null ? r.delta_pct.toFixed(2) : '' },
  { header: 'change_note',       accessor: (r) => r.change_note ?? '' },
];

/** Repli LEGACY : les liens copiés avant l'unification portent `?from=&to=`. */
const LEGACY_KEYS = { start: 'from', end: 'to' } as const;

interface KpiDescriptor { key: string; label: string; value: string; note?: string | undefined }

export function RecipeCostTimelinePage(): JSX.Element {
  const { productId = '' } = useParams<{ productId: string }>();
  const period = useReportPeriod({ legacyKeys: LEGACY_KEYS });
  const { start, end } = period;

  const q = useRecipeCostTimeline(productId, start, end);

  const rows = useMemo(() => q.data ?? [], [q.data]);
  const productName = rows[0]?.product_name ?? 'Recipe Cost Timeline';

  const rowsWithDelta = useMemo<TimelineRowWithDelta[]>(() => rows.map((r, i) => {
    const prev = rows[i - 1]?.cost_per_unit;
    const delta = (prev === undefined || prev === 0)
      ? null
      : round2(((r.cost_per_unit - prev) / prev) * 100);
    return { ...r, delta_pct: delta };
  }), [rows]);

  // Audit R-20 — `created_at` est un timestamptz : le découper en `slice(0,10)`
  // affichait la date UTC en la présentant comme locale. On résout le fuseau
  // métier.
  const chartData = useMemo(() => rows.map((r) => ({
    date: toLocalDateStr(r.created_at),
    cost: r.cost_per_unit,
  })), [rows]);

  const first = rows[0];
  const last  = rows[rows.length - 1];
  // La variation sur la fenêtre : de la PREMIÈRE version connue à la dernière.
  // Base nulle ou négative → pas de ratio (un coût unitaire nul n'a pas de
  // variation relative).
  const windowDelta = first !== undefined && last !== undefined && first.cost_per_unit > 0
    ? round2(((last.cost_per_unit - first.cost_per_unit) / first.cost_per_unit) * 100)
    : null;
  const biggestJump = rowsWithDelta.reduce<number | null>((best, r) => {
    if (r.delta_pct === null) return best;
    if (best === null || Math.abs(r.delta_pct) > Math.abs(best)) return r.delta_pct;
    return best;
  }, null);

  const safeName = productName.replace(/[^a-zA-Z0-9_-]/g, '_').slice(0, 40);

  // Audit R-13 — le template PDF `recipe_timeline` était construit mais
  // inatteignable : la page n'exposait qu'un CSV maison.
  const pdfData = useMemo(() => ({
    product_name: productName,
    rows: rowsWithDelta.map((r) => ({
      version:       r.version_number,
      cost_per_unit: r.cost_per_unit,
      delta_pct:     r.delta_pct,
      created_at:    r.created_at,
    })),
  }), [productName, rowsWithDelta]);

  const tiles: KpiDescriptor[] = [
    {
      key: 'current', label: 'Current cost',
      value: last !== undefined ? formatIdrPrecise(last.cost_per_unit) : '—',
      note:  last !== undefined ? `version ${last.version_number}` : 'no version in window',
    },
    {
      key: 'baseline', label: 'First in window',
      value: first !== undefined ? formatIdrPrecise(first.cost_per_unit) : '—',
      note:  first !== undefined ? `version ${first.version_number}` : undefined,
    },
    {
      key: 'window-delta', label: 'Move over window',
      value: formatDeltaPct(windowDelta),
      note:  'first to last version',
    },
    {
      key: 'versions', label: 'Versions',
      value: formatCount(rows.length),
      note:  'recipe revisions in window',
    },
    {
      key: 'biggest-jump', label: 'Biggest single step',
      value: formatDeltaPct(biggestJump),
      note:  'largest version-to-version move',
    },
    {
      key: 'last-change', label: 'Last change',
      value: last !== undefined ? toLocalDateStr(last.created_at) : '—',
    },
  ];

  if (productId === '') {
    return (
      <ReportShell
        title="Recipe Cost Timeline"
        breadcrumb={[{ label: 'Reports', to: '/backoffice/reports' }, { label: 'Inventory' }]}
      >
        <PanelCard title="Recipe" testId="timeline-missing-product">
          <p className="py-2 text-xs text-text-muted">Missing product id.</p>
        </PanelCard>
      </ReportShell>
    );
  }

  const toolbar = (
    <>
      <PeriodControl period={period} />
      <ExportMenu
        csv={{
          rows: rowsWithDelta,
          columns: TIMELINE_CSV_COLUMNS,
          filename: `recipe-cost-timeline-${safeName}-${start}_${end}`,
        }}
        pdf={{
          template: 'recipe_timeline',
          data: pdfData,
          period: { start, end },
          filename: `recipe-cost-timeline-${safeName}-${start}_${end}`,
        }}
        disabled={rows.length === 0}
      />
    </>
  );

  return (
    <ReportShell
      title={productName}
      subtitle={`${periodLabel(start, end)} · unit-cost history, version by version`}
      breadcrumb={[
        { label: 'Reports', to: '/backoffice/reports' },
        { label: 'Recipe Cost Overview', to: '/backoffice/reports/recipe-cost' },
        { label: productName },
      ]}
      toolbar={toolbar}
      error={q.error}
      isEmpty={!q.isLoading && q.error == null && rows.length === 0}
      emptyState={{
        title: 'No cost history',
        description: 'No cost history for this product in the selected window.',
        'data-testid': 'empty-timeline',
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
      {/* Le fil d'Ariane porte déjà le retour ; ce lien reste parce qu'il est la
          sortie ATTENDUE d'un drill-down ouvert depuis la vue d'ensemble. */}
      <Link
        to="/backoffice/reports/recipe-cost"
        className="inline-block text-xs text-text-secondary underline-offset-2 hover:underline focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-gold"
        data-testid="timeline-back-link"
      >
        ← Recipe Cost Overview
      </Link>

      <PanelCard
        title="Unit cost over versions"
        className="mt-3"
        subtitle="Each point is a recipe revision, not a day — nothing happened between two of them."
        isLoading={q.isLoading}
        testId="timeline-chart"
      >
        <TrendLineChart
          data={chartData}
          xKey="date"
          currentKey="cost"
          currentName="Cost / unit"
          dots
          yTickFormatter={formatIdrCompact}
          valueFormatter={formatIdrPrecise}
          ariaLabel={`Unit cost for ${productName} across ${rows.length} recipe versions, ${start} to ${end}.`}
        />
      </PanelCard>

      <PanelCard
        title="Versions"
        className="mt-3"
        subtitle="Cost per version, with the move against the version before it."
        isLoading={q.isLoading}
        testId="timeline-versions"
      >
        <div className="overflow-x-auto">
          <table className="w-full text-sm" data-testid="timeline-table">
            <caption className="sr-only">
              Version number, date, unit cost, move versus the previous version and change note
            </caption>
            <thead>
              <tr className="border-b border-border-subtle text-text-secondary">
                <th scope="col" className="py-2 text-left">Version</th>
                <th scope="col" className="py-2 text-left">Date</th>
                <th scope="col" className="py-2 text-right">Cost</th>
                <th scope="col" className="py-2 text-right">Δ vs prev</th>
                <th scope="col" className="py-2 text-left">Change note</th>
              </tr>
            </thead>
            <tbody>
              {rowsWithDelta.map((r) => (
                <tr
                  key={`${r.product_id}-${r.version_number}`}
                  className="border-t border-border-subtle"
                  data-testid={`timeline-row-v${r.version_number}`}
                >
                  <td className="py-1.5 font-data tabular-nums">v{r.version_number}</td>
                  <td className="py-1.5 font-data tabular-nums text-text-secondary">
                    {new Date(r.created_at).toLocaleString('id-ID', {
                      timeZone: DEFAULT_TIMEZONE,
                      dateStyle: 'short',
                      timeStyle: 'short',
                    })}
                  </td>
                  <td className={NUM_CELL}>{formatIdrPrecise(r.cost_per_unit)}</td>
                  <td className={cn(NUM_CELL, deltaTone(r.delta_pct))}>
                    {formatDeltaPct(r.delta_pct)}
                  </td>
                  <td className="py-1.5 text-text-secondary">{r.change_note ?? '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </PanelCard>
    </ReportShell>
  );
}

export default RecipeCostTimelinePage;
