// apps/backoffice/src/pages/reports/BasketAnalysisPage.tsx
//
// Lot D (campagne Reports 2026-08-15) — vague Sales, page 6/6. Migrée sur le
// socle Report shell v2 (archétype maquette 4c, patron : DailySalesPage).
//
// AUCUN GRAPHE, délibérément. Une paire produit n'a ni axe temporel ni base
// commune : la tracer donnerait une figure décorative là où une table de paires
// bien mise en forme se lit d'un coup. Ce que la page gagne, c'est la bande KPI
// qui répond à la question d'ouverture (« quelle paire pousser ? ») et le
// chrome unifié — pas un graphique gadget.
//
// Le lavis doré des trois premières lignes est retiré : `i < 3 && lift > 1`
// était un signal de couleur SANS légende, donc un code privé, et son seuil
// était arbitraire. La paire de tête est nommée dans la bande KPI, et la
// colonne « Lift » porte sa définition sous la table.

import { useMemo, type JSX } from 'react';
import { Link } from 'react-router-dom';
import type { CsvColumn } from '@breakery/domain';
import { Input } from '@breakery/ui';
import { PanelCard } from '@/components/PanelCard.js';
import { KpiTile, KPI_NOTE, KPI_NOTE_HERO } from '@/components/kpi/KpiTile.js';
import { ReportShell } from '@/features/reports/components/ReportShell.js';
import { KpiBand } from '@/features/reports/components/KpiBand.js';
import { PeriodControl } from '@/features/reports/components/PeriodControl.js';
import { ExportMenu } from '@/features/reports/components/ExportMenu.js';
import { useReportPeriod } from '@/features/reports/hooks/useReportPeriod.js';
import {
  useBasketAnalysis, type BasketPair,
} from '@/features/reports/hooks/useBasketAnalysis.js';
import { useUrlState } from '@/hooks/useUrlState.js';
import { buildDrilldownUrl } from '@/features/reports/utils/buildDrilldownUrl.js';
import { formatCount, formatPct1, periodLabel } from '@/features/reports/utils/reportFigures.js';

const csvColumns: CsvColumn<BasketPair>[] = [
  { header: 'Product A',    accessor: (r) => r.product_a_name,      format: 'text' },
  { header: 'Product B',    accessor: (r) => r.product_b_name,      format: 'text' },
  { header: 'Co-occurrence',accessor: (r) => r.co_occurrence_count, format: 'number' },
  { header: 'Confidence',   accessor: (r) => r.confidence,          format: 'percent' },
  { header: 'Lift',         accessor: (r) => r.lift.toFixed(2),     format: 'text' },
];

const NUM_CELL = 'py-2 text-right font-data tabular-nums';
const INK_LINK = 'text-gold underline-offset-2 hover:underline focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-gold';

interface KpiDescriptor {
  key: string; label: string; value: string; note: string;
}

/** « 2,50× » — le multiplicateur de co-achat, en locale métier. */
function formatLift(v: number): string {
  return `${v.toLocaleString('id-ID', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}×`;
}

function pairLabel(p: BasketPair): string {
  return `${p.product_a_name} + ${p.product_b_name}`;
}

export default function BasketAnalysisPage(): JSX.Element {
  // Bornes déjà nommées `start` / `end` : aucun repli de nom nécessaire.
  const period = useReportPeriod();
  const { start, end } = period;

  // Audit R-17 — le plafond reste en URL-state (convention S57) : la vue est
  // partageable et survit au rechargement.
  const [topNRaw, setTopNRaw] = useUrlState('top_n', '10');
  const topN = Math.min(100, Math.max(1, Number(topNRaw) || 10));

  const { data, isLoading, error } = useBasketAnalysis(start, end, topN);
  const rows = useMemo(() => data ?? [], [data]);

  const best = useMemo(
    () => rows.reduce<BasketPair | null>((b, r) => (b === null || r.lift > b.lift ? r : b), null),
    [rows],
  );
  const surest = useMemo(
    () => rows.reduce<BasketPair | null>(
      (b, r) => (b === null || r.confidence > b.confidence ? r : b), null),
    [rows],
  );
  const coOccurrences = rows.reduce((s, r) => s + r.co_occurrence_count, 0);

  // Aucune comparaison : la RPC ne rend qu'une fenêtre, et un lift comparé d'une
  // période à l'autre changerait de paires en route. Chaque tuile porte donc une
  // note neutre plutôt qu'une variation vide.
  const tiles: KpiDescriptor[] = [
    {
      key: 'top-lift', label: 'Strongest pair',
      value: best !== null ? formatLift(best.lift) : '—',
      note:  best !== null ? pairLabel(best) : 'no paired sale in this period',
    },
    {
      key: 'pairs', label: 'Pairs listed', value: formatCount(rows.length),
      note:  `top ${formatCount(topN)} by lift`,
    },
    {
      key: 'co-occurrences', label: 'Co-occurrences', value: formatCount(coOccurrences),
      note:  'baskets across the listed pairs',
    },
    {
      key: 'best-confidence', label: 'Best confidence',
      value: surest !== null ? formatPct1(surest.confidence * 100) : '—',
      note:  surest !== null ? pairLabel(surest) : 'no paired sale in this period',
    },
  ];

  const meta = [
    periodLabel(start, end),
    `${formatCount(rows.length)} pair${rows.length === 1 ? '' : 's'}`,
    'ranked by lift — cross-sell opportunities',
  ].join(' · ');

  const toolbar = (
    <>
      <label className="flex items-center gap-1.5 text-sm text-text-secondary">
        <span>Top N</span>
        <Input
          type="number"
          min={1}
          max={100}
          value={topN}
          onChange={(e) => setTopNRaw(e.target.value)}
          className="h-8 w-20"
          aria-label="Top N"
        />
      </label>
      <PeriodControl period={period} />
      <ExportMenu
        csv={{ rows, columns: csvColumns, filename: `basket-analysis-${start}_${end}` }}
        pdf={{
          template: 'basket',
          data:     rows,
          period:   { start, end },
          filename: `basket-analysis-${start}_${end}`,
        }}
        disabled={rows.length === 0}
      />
    </>
  );

  return (
    <ReportShell
      title="Basket Analysis"
      subtitle={meta}
      breadcrumb={[{ label: 'Reports', to: '/backoffice/reports' }, { label: 'Sales' }]}
      toolbar={toolbar}
      error={error}
      isEmpty={!isLoading && error === null && data !== undefined && rows.length === 0}
      emptyState={{
        title: 'No paired sales',
        description: 'No paired sales in the selected range.',
      }}
      kpis={
        <KpiBand isLoading={isLoading} tiles={tiles.length} labels={tiles.map((t) => t.label)}>
          {tiles.map((t, i) => (
            <KpiTile key={t.key} label={t.label} value={t.value} hero={i === 0} testId={`kpi-${t.key}`}>
              <span className={i === 0 ? KPI_NOTE_HERO : KPI_NOTE}>{t.note}</span>
            </KpiTile>
          ))}
        </KpiBand>
      }
    >
      <PanelCard
        title="Top product pairs"
        subtitle="Products bought in the same basket, ranked by how much more often than chance."
        isLoading={isLoading}
        footer={
          <span className="text-text-muted">
            Lift above 1,00× means the pair sells together more often than the two products&apos;
            individual rates would predict. Confidence is how often B follows A.
          </span>
        }
        testId="basket-pairs-table"
      >
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <caption className="sr-only">
              Product pairs frequently bought together, with co-occurrence, confidence and lift
            </caption>
            <thead>
              <tr className="border-b border-border-subtle text-text-secondary">
                <th scope="col" className="py-2 text-left">Product A</th>
                <th scope="col" className="py-2 text-left">Product B</th>
                <th scope="col" className="py-2 text-right">Co-occurrence</th>
                <th scope="col" className="py-2 text-right">Confidence</th>
                <th scope="col" className="py-2 text-right">Lift</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => {
                const urlA = buildDrilldownUrl('product', r.product_id_a);
                const urlB = buildDrilldownUrl('product', r.product_id_b);
                return (
                  <tr key={`${r.product_id_a}_${r.product_id_b}`} className="border-b border-border-subtle">
                    <td className="py-2">
                      {urlA !== null
                        ? <Link to={urlA} className={INK_LINK}>{r.product_a_name}</Link>
                        : r.product_a_name}
                    </td>
                    <td className="py-2">
                      {urlB !== null
                        ? <Link to={urlB} className={INK_LINK}>{r.product_b_name}</Link>
                        : r.product_b_name}
                    </td>
                    <td className={NUM_CELL}>{formatCount(r.co_occurrence_count)}</td>
                    <td className={NUM_CELL}>{formatPct1(r.confidence * 100)}</td>
                    <td className={`${NUM_CELL} font-semibold`}>{formatLift(r.lift)}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </PanelCard>
    </ReportShell>
  );
}
