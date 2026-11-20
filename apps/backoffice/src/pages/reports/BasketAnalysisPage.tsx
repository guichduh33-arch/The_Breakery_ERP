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

import { useMemo, useState, type JSX } from 'react';
import { Link } from 'react-router-dom';
import type { CsvColumn } from '@breakery/domain';
import { Input } from '@breakery/ui';
import { PanelCard } from '@/components/PanelCard.js';
import { KpiTile, KPI_NOTE, KPI_NOTE_HERO } from '@/components/kpi/KpiTile.js';
import { ReportShell } from '@/features/reports/components/ReportShell.js';
import { KpiBand } from '@/features/reports/components/KpiBand.js';
import { PeriodControl } from '@/features/reports/components/PeriodControl.js';
import { ExportMenu } from '@/features/reports/components/ExportMenu.js';
import { ReportFilterBar } from '@/features/reports/components/ReportFilterBar.js';
import { ReportTable, type ReportColumn } from '@/features/reports/components/ReportTable.js';
import {
  PaymentFilterNote, SALES_ORDER_FILTER_DEFS, toSalesOrderFilters,
} from '@/features/reports/components/salesOrderFilters.js';
import { useReportPeriod } from '@/features/reports/hooks/useReportPeriod.js';
import { useReportFilters } from '@/features/reports/hooks/useReportFilters.js';
import type { SortSpec } from '@/features/reports/hooks/useSortedRows.js';
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

const INK_LINK = 'text-gold underline-offset-2 hover:underline focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-gold';
const EXTRA_FILTER_KEYS = ['q'] as const;
type SortKey = 'product_a' | 'product_b' | 'co_occurrence' | 'confidence' | 'lift';
const SORT_SPECS: Record<SortKey, SortSpec<BasketPair>> = {
  product_a: { kind: 'string', value: (r) => r.product_a_name },
  product_b: { kind: 'string', value: (r) => r.product_b_name },
  co_occurrence: { kind: 'number', value: (r) => r.co_occurrence_count },
  confidence: { kind: 'number', value: (r) => r.confidence },
  lift: { kind: 'number', value: (r) => r.lift },
};

function productLink(id: string, name: string): JSX.Element {
  const url = buildDrilldownUrl('product', id);
  return url !== null ? <Link to={url} className={INK_LINK}>{name}</Link> : <>{name}</>;
}

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
  const topN = Math.min(100, Math.max(1, Math.trunc(Number(topNRaw)) || 10));

  const filters = useReportFilters(SALES_ORDER_FILTER_DEFS, { extraKeys: EXTRA_FILTER_KEYS });
  const { order_type: orderType, payment_method: paymentMethod, table_number: tableNumber } = filters.values;
  const orderFilters = useMemo(() => toSalesOrderFilters({
    order_type: orderType, payment_method: paymentMethod, table_number: tableNumber,
  }), [orderType, paymentMethod, tableNumber]);
  const { data, isLoading, error } = useBasketAnalysis(start, end, topN, orderFilters);
  const rows = useMemo(() => data ?? [], [data]);
  const [visibleRows, setVisibleRows] = useState<readonly BasketPair[]>([]);
  const exportRows = [...visibleRows];

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
  const columns = useMemo<ReportColumn<BasketPair, SortKey>[]>(() => [
    { id: 'product_a', header: 'Product A', sortKey: 'product_a', footer: 'Listed pairs',
      cell: (r) => productLink(r.product_id_a, r.product_a_name), searchText: (r) => r.product_a_name },
    { id: 'product_b', header: 'Product B', sortKey: 'product_b',
      cell: (r) => productLink(r.product_id_b, r.product_b_name), searchText: (r) => r.product_b_name },
    { id: 'co_occurrence', header: 'Co-occurrence', sortKey: 'co_occurrence', align: 'right',
      cell: (r) => formatCount(r.co_occurrence_count), footer: formatCount(coOccurrences) },
    { id: 'confidence', header: 'Confidence', sortKey: 'confidence', align: 'right',
      cell: (r) => formatPct1(r.confidence * 100) },
    { id: 'lift', header: 'Lift', sortKey: 'lift', align: 'right', className: 'font-semibold',
      cell: (r) => formatLift(r.lift) },
  ], [coOccurrences]);

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
      note:  'pair occurrences, not unique baskets',
    },
    {
      key: 'best-confidence', label: 'Best confidence',
      value: surest !== null ? formatPct1(surest.confidence * 100) : '—',
      note:  surest !== null ? pairLabel(surest) : 'no paired sale in this period',
    },
  ];

  const activeCount = Object.keys(filters.active).length;
  const meta = [
    periodLabel(start, end),
    `${formatCount(rows.length)} pair${rows.length === 1 ? '' : 's'}`,
    'ranked by lift — cross-sell opportunities',
    ...(activeCount > 0 ? [`${activeCount} filter${activeCount === 1 ? '' : 's'} active`] : []),
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
        csv={{ rows: exportRows, columns: csvColumns, filename: `basket-analysis-${start}_${end}` }}
        pdf={{
          template: 'basket',
          data:     exportRows,
          period:   { start, end },
          filename: `basket-analysis-${start}_${end}`,
        }}
        disabled={isLoading || error !== null || rows.length === 0 || exportRows.length === 0}
      />
    </>
  );

  return (
    <ReportShell
      title="Basket Analysis"
      subtitle={meta}
      breadcrumb={[{ label: 'Reports', to: '/backoffice/reports' }, { label: 'Sales' }]}
      toolbar={toolbar}
      filters={
        <ReportFilterBar defs={SALES_ORDER_FILTER_DEFS} filters={filters}
          note={paymentMethod !== '' ? <PaymentFilterNote /> : undefined} />
      }
      error={error}
      isEmpty={!isLoading && error === null && data !== undefined && rows.length === 0}
      emptyState={{
        title: 'No paired sales',
        description: activeCount > 0
          ? 'No paired sales match these filters in the selected range.'
          : 'No paired sales in the selected range.',
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
        <p className="mb-3 text-xs text-text-secondary">
          Figures describe the selected top pairs. Search narrows the table and exports only.
        </p>
        <ReportTable rows={rows} columns={columns} sortSpecs={SORT_SPECS}
          rowKey={(r) => `${r.product_id_a}_${r.product_id_b}`}
          caption="Product pairs frequently bought together, with co-occurrence, confidence and lift"
          showFooter search={{ label: 'Search pairs', placeholder: 'Search products', noun: 'pair', urlKey: 'q' }}
          testId="basket-report-table" onVisibleRowsChange={setVisibleRows} />
      </PanelCard>
    </ReportShell>
  );
}
