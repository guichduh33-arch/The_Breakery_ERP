// apps/backoffice/src/pages/reports/ProductionVsSalesPage.tsx
//
// S3-19 — « Production vs Sales » : ce qui a été produit chaque jour, face à ce
// qui s'est vendu (comptoir et B2B) et à ce qui a été jeté avec approbation,
// par article, par catégorie et par jour. Rapport INFORMATIF, réservé au
// propriétaire (garde serveur P0003, rendue par la bannière du socle comme sur
// Stock Position) : il ne lit que des quantités et n'écrit rien.
//
// La question : « est-ce que je produis ce que je vends ? ». D'où :
//  · le graphe principal met production et ventes CÔTE À CÔTE, jour par jour ;
//  · le second classe les articles par écart — un écart positif est de la
//    surproduction, un écart négatif dit qu'on a vendu du stock antérieur ;
//  · la table (trois vues, persistées dans l'URL) porte le détail, et un clic
//    sur un article ouvre ses jours sans nouvel appel.
//
// Les options du filtre Item viennent du résultat SANS filtre article (même
// période, même catégorie). Sans filtre article, les deux requêtes ont la même
// clé : react-query n'en envoie qu'une.

import { useCallback, useMemo, useState, type JSX } from 'react';
import { Link } from 'react-router-dom';
import { Tabs, TabsContent, cn } from '@breakery/ui';
import { FOCUS_RING } from '@/components/focusRing.js';
import { PanelCard } from '@/components/PanelCard.js';
import { KpiTile, KPI_NOTE, KPI_NOTE_HERO } from '@/components/kpi/KpiTile.js';
import { TabsList, TabsTrigger } from '@/components/BackofficeUi.js';
import { useUrlState } from '@/hooks/useUrlState.js';
import { ReportShell } from '@/features/reports/components/ReportShell.js';
import { KpiBand } from '@/features/reports/components/KpiBand.js';
import { PeriodControl } from '@/features/reports/components/PeriodControl.js';
import { ExportMenu } from '@/features/reports/components/ExportMenu.js';
import { ReportFilterBar } from '@/features/reports/components/ReportFilterBar.js';
import { ReportTable } from '@/features/reports/components/ReportTable.js';
import { PairedBarsChart } from '@/features/reports/components/charts/PairedBarsChart.js';
import { StackedBarsChart } from '@/features/reports/components/charts/StackedBarsChart.js';
import {
  PVS_CATEGORY_CSV, PVS_CATEGORY_SORT_SPECS, PVS_DAY_CSV, PVS_DAY_SORT_SPECS,
  PVS_ITEM_CSV, PVS_ITEM_SORT_SPECS, buildPvsCategoryColumns, buildPvsDayColumns,
  buildPvsItemColumns, formatSellThrough,
} from '@/features/reports/components/productionVsSalesColumns.js';
import { ProductionVsSalesItemDrawer } from '@/features/reports/components/ProductionVsSalesItemDrawer.js';
import { useReportPeriod } from '@/features/reports/hooks/useReportPeriod.js';
import { useReportFilters, type ReportFilterDef } from '@/features/reports/hooks/useReportFilters.js';
import {
  useProductionVsSales, type PvsCategoryRow, type PvsDayRow, type PvsProductRow,
} from '@/features/reports/hooks/useProductionVsSales.js';
import { CHART_1, categoricalColor } from '@/features/reports/utils/chartColors.js';
import { formatCount, periodLabel, shortDate } from '@/features/reports/utils/reportFigures.js';

type FilterKey = 'category_id' | 'product_id';
const SEARCH_KEY = 'q';
const EXTRA_FILTER_KEYS: readonly string[] = [SEARCH_KEY];

const VIEWS = ['item', 'category', 'day'] as const;
type View = (typeof VIEWS)[number];
const VIEW_LABEL: Record<View, string> = { item: 'By item', category: 'By category', day: 'By day' };

/** Barres du classement d'écart : au-delà, l'axe devient illisible. */
const MAX_SURPLUS_BARS = 8;
const MAX_SHORT_BARS = 4;
const MAX_TICK_CHARS = 16;
/** Page où le propriétaire relit les restes déclarés par la caisse. */
const LEFTOVERS_URL = '/backoffice/inventory/opname';

function truncate(s: string): string {
  return s.length > MAX_TICK_CHARS ? `${s.slice(0, MAX_TICK_CHARS - 1)}…` : s;
}

/** Écart signé pour une tuile : moins typographique, jamais une couleur seule. */
function signedCount(v: number): string {
  return v < 0 ? `−${formatCount(Math.abs(v))}` : formatCount(v);
}

export default function ProductionVsSalesPage(): JSX.Element {
  const period = useReportPeriod();
  const { start, end } = period;
  const [opened, setOpened] = useState<{ id: string; name: string } | null>(null);
  // Lignes AFFICHÉES par chaque vue (recherche et tri appliqués) : l'export
  // reprend ce que la table montre, pas le jeu complet.
  const [visibleItems, setVisibleItems] = useState<readonly PvsProductRow[]>([]);
  const [visibleCategories, setVisibleCategories] = useState<readonly PvsCategoryRow[]>([]);
  const [visibleDays, setVisibleDays] = useState<readonly PvsDayRow[]>([]);
  const [viewRaw, setViewRaw] = useUrlState('view', 'item');
  const view: View = VIEWS.find((v) => v === viewRaw) ?? 'item';

  // Lecture des clés d'URL AVANT les définitions : les options dépendent de la
  // requête de base, qui dépend elle-même de la catégorie.
  const [categoryParam] = useUrlState('category_id', '');
  const [productParam] = useUrlState('product_id', '');
  const categoryId = categoryParam.trim();
  const productId = productParam.trim();

  const base = useProductionVsSales({ start, end, categoryId: categoryId || null, productId: null });
  const current = useProductionVsSales({
    start, end, categoryId: categoryId || null, productId: productId || null,
  });

  const filterDefs = useMemo<readonly ReportFilterDef<FilterKey>[]>(() => [
    {
      kind: 'select', key: 'category_id', label: 'Category', allLabel: 'All categories',
      options: (base.data?.categories ?? []).map((c) => ({ value: c.id, label: c.name })),
    },
    {
      kind: 'select', key: 'product_id', label: 'Item', allLabel: 'All items', width: 'w-48',
      options: (base.data?.by_product ?? [])
        .map((p) => ({ value: p.product_id, label: p.product_name }))
        .sort((a, b) => a.label.localeCompare(b.label)),
    },
  ], [base.data]);
  const filters = useReportFilters(filterDefs, { extraKeys: EXTRA_FILTER_KEYS });

  const data = current.isError ? undefined : current.data;
  const summary = data?.summary;
  const byProduct = useMemo(() => data?.by_product ?? [], [data]);
  const byCategory = useMemo(() => data?.by_category ?? [], [data]);
  const byDay = useMemo(() => data?.by_day ?? [], [data]);
  const error = current.error ?? base.error;

  const openedRow: PvsProductRow | null = opened === null
    ? null
    : byProduct.find((p) => p.product_id === opened.id) ?? null;

  // Fenêtre bornée à 92 jours côté serveur : un début rogné se DIT.
  const clipped = data !== undefined && data.period.start > start;
  const servedStart = data?.period.start ?? start;
  const servedEnd = data?.period.end ?? end;

  const dailyRows = useMemo(
    () => byDay.map((d) => ({ date: d.date, produced: d.produced, sold: d.sold_total })),
    [byDay],
  );
  const dailyHasData = byDay.some((d) => d.produced > 0 || d.sold_total > 0);

  // Classement des écarts : les plus gros surplus, puis les plus grosses ventes
  // au-delà de la production. L'ordre reste celui de la RPC (écart décroissant).
  const gapRows = useMemo(() => {
    const surplus = byProduct.filter((p) => p.gap > 0).slice(0, MAX_SURPLUS_BARS);
    const short = byProduct.filter((p) => p.gap < 0).slice(-MAX_SHORT_BARS);
    return [...surplus, ...short].map((p) => ({
      name: p.product_name, surplus: Math.max(p.gap, 0), beyond: Math.min(p.gap, 0),
    }));
  }, [byProduct]);
  const gapCount = byProduct.filter((p) => p.gap !== 0).length;

  // Cliquer une catégorie applique le filtre Category (une navigation d'URL).
  const { setValue } = filters;
  const setCategory = useCallback((id: string): void => { setValue('category_id', id); }, [setValue]);

  const itemColumns = useMemo(
    () => buildPvsItemColumns({ summary, onOpen: setOpened, onCategoryFilter: setCategory }),
    [summary, setCategory],
  );
  const categoryColumns = useMemo(
    () => buildPvsCategoryColumns({ summary, onCategoryFilter: setCategory }),
    [summary, setCategory],
  );
  const dayColumns = useMemo(() => buildPvsDayColumns({ summary }), [summary]);

  const tiles = [
    { key: 'produced', label: 'Produced', value: formatCount(summary?.produced ?? 0), note: 'batches recorded' },
    {
      key: 'sold', label: 'Sold', value: formatCount(summary?.sold_total ?? 0),
      note: `Counter ${formatCount(summary?.sold_counter ?? 0)} · B2B ${formatCount(summary?.sold_b2b ?? 0)}`,
    },
    { key: 'waste', label: 'Approved waste', value: formatCount(summary?.wasted ?? 0), note: 'approved losses only' },
    {
      key: 'gap', label: 'Gap', value: signedCount(summary?.gap ?? 0),
      note: (summary?.gap ?? 0) < 0 ? 'sold beyond output' : 'produced − sold − waste',
    },
    {
      key: 'unexplained', label: 'Unexplained',
      value: summary === undefined || summary.unexplained === null ? '—' : signedCount(summary.unexplained),
      note: summary === undefined || summary.unknown_cells === 0
        ? 'after end-of-day counts'
        : `${formatCount(summary.unknown_cells)} item-day${summary.unknown_cells === 1 ? '' : 's'} not counted`,
    },
    {
      key: 'sell-through', label: 'Sell-through', value: formatSellThrough(summary?.sell_through_pct ?? null),
      note: 'sold ÷ produced',
    },
  ];
  // Jours servis sans déclaration de restes : le bilan de ces jours (et du
  // lendemain) reste inconnu.
  const daysWithoutCount = byDay.filter((d) => !d.has_closing).length;

  const activeCount = Object.keys(filters.active).length;
  const meta = [
    periodLabel(start, end),
    `${formatCount(byProduct.length)} item${byProduct.length === 1 ? '' : 's'}`,
    'quantities only',
    ...(activeCount > 0 ? [`${activeCount} filter${activeCount === 1 ? '' : 's'} active`] : []),
  ].join(' · ');

  const toolbar = (
    <>
      <PeriodControl period={period} />
      {/* Export de la vue AFFICHÉE, lignes visibles dans l'ordre affiché. Les
          lignes diffèrent d'une vue à l'autre : un menu par vue garde chaque
          jeu de colonnes typé. Le jeu source vide désactive aussi l'export :
          la table démontée (état vide) ne rappelle plus ses lignes. */}
      {view === 'item' && (
        <ExportMenu
          csv={{ rows: [...visibleItems], columns: PVS_ITEM_CSV, filename: `production-vs-sales-items-${servedStart}_${servedEnd}` }}
          disabled={byProduct.length === 0 || visibleItems.length === 0 || current.isFetching}
        />
      )}
      {view === 'category' && (
        <ExportMenu
          csv={{ rows: [...visibleCategories], columns: PVS_CATEGORY_CSV, filename: `production-vs-sales-categories-${servedStart}_${servedEnd}` }}
          disabled={byCategory.length === 0 || visibleCategories.length === 0 || current.isFetching}
        />
      )}
      {view === 'day' && (
        <ExportMenu
          csv={{ rows: [...visibleDays], columns: PVS_DAY_CSV, filename: `production-vs-sales-days-${servedStart}_${servedEnd}` }}
          disabled={byDay.length === 0 || visibleDays.length === 0 || current.isFetching}
        />
      )}
    </>
  );

  return (
    <ReportShell
      title="Production vs Sales"
      subtitle={meta}
      breadcrumb={[{ label: 'Reports', to: '/backoffice/reports' }, { label: 'Production' }]}
      toolbar={toolbar}
      filters={<ReportFilterBar defs={filterDefs} filters={filters} />}
      error={error}
      isEmpty={!current.isLoading && data !== undefined && byProduct.length === 0}
      emptyState={{
        title: 'Nothing produced or sold',
        description: 'No fresh item was produced, sold or written off in the selected dates and filters.',
      }}
      kpis={
        <KpiBand isLoading={current.isLoading} tiles={tiles.length} labels={tiles.map((t) => t.label)}>
          {tiles.map((t, i) => (
            <KpiTile key={t.key} label={t.label} value={t.value} hero={i === 0} testId={`kpi-${t.key}`}>
              <span className={i === 0 ? KPI_NOTE_HERO : KPI_NOTE}>{t.note}</span>
            </KpiTile>
          ))}
        </KpiBand>
      }
    >
      {clipped && data !== undefined && (
        <p
          role="note"
          className="rounded-sm border border-border-subtle bg-surface-4 px-3 py-2 text-xs text-text-secondary"
          data-testid="period-clipped"
        >
          This report covers at most 92 days: showing {periodLabel(data.period.start, data.period.end)} instead
          of {periodLabel(start, end)}.
        </p>
      )}
      {data !== undefined && daysWithoutCount > 0 && (
        <p
          role="note"
          className="mt-2 rounded-sm border border-border-subtle bg-surface-4 px-3 py-2 text-xs text-text-secondary"
          data-testid="pvs-missing-counts"
        >
          {formatCount(daysWithoutCount)} of {formatCount(byDay.length)} day{byDay.length === 1 ? '' : 's'} have
          no end-of-day count from the till: the unexplained quantity of those days, and of the day after, is
          unknown.{' '}
          <Link to={LEFTOVERS_URL} className={cn('rounded-sm text-gold underline-offset-2 hover:underline', FOCUS_RING)}>
            Review end-of-day counts
          </Link>
        </p>
      )}

      <div className="mt-3 grid gap-3 xl:grid-cols-[1.4fr_1fr]">
        <PanelCard title="Produced vs sold, per day" isLoading={current.isLoading} testId="chart-daily">
          {dailyHasData ? (
            <PairedBarsChart
              data={dailyRows}
              xKey="date"
              currentKey="produced"
              currentName="Produced"
              compareKey="sold"
              compareName="Sold"
              xTickFormatter={(v) => shortDate(String(v))}
              yTickFormatter={formatCount}
              valueFormatter={formatCount}
              ariaLabel={`Quantity produced and quantity sold per day, from ${start} to ${end}.`}
            />
          ) : (
            <p className="py-12 text-center text-sm text-text-muted" data-testid="chart-daily-empty">
              Nothing produced or sold on these days.
            </p>
          )}
        </PanelCard>
        <PanelCard
          title="Largest gaps by item"
          aside={gapCount > gapRows.length ? (
            <span className="text-xs text-text-muted">{gapRows.length} of {formatCount(gapCount)}</span>
          ) : undefined}
          isLoading={current.isLoading}
          testId="chart-gap"
        >
          {gapRows.length > 0 ? (
            <StackedBarsChart
              data={gapRows}
              xKey="name"
              layout="horizontal-bars"
              series={[
                { key: 'surplus', name: 'Unsold (surplus)', color: CHART_1 },
                { key: 'beyond', name: 'Sold beyond output', color: categoricalColor(1) },
              ]}
              xTickFormatter={(v) => truncate(String(v))}
              yTickFormatter={formatCount}
              valueFormatter={(v) => formatCount(Math.abs(v))}
              categoryAxisWidth={128}
              ariaLabel="Items with the largest gap between production and sales. Bars to the right are unsold surplus, bars to the left are sales beyond the day's output."
            />
          ) : (
            <p className="py-12 text-center text-sm text-text-muted" data-testid="chart-gap-empty">
              No gap: everything produced was sold or written off.
            </p>
          )}
        </PanelCard>
      </div>

      <PanelCard
        title="Detail"
        aside={view === 'item'
          ? <span className="text-xs text-text-muted">Pick an item to see its days</span>
          : view === 'category'
            ? <span className="text-xs text-text-muted">Pick a category to filter the report</span>
            : undefined}
        className="mt-3"
        isLoading={current.isLoading}
        testId="pvs-detail"
      >
        <Tabs value={view} onValueChange={(v) => { setViewRaw(VIEWS.find((x) => x === v) ?? 'item'); }}>
          <TabsList className="mb-3 border-b border-border-subtle">
            {VIEWS.map((v) => (
              <TabsTrigger key={v} value={v} data-testid={`view-${v}`}>{VIEW_LABEL[v]}</TabsTrigger>
            ))}
          </TabsList>
          {/* Radix ne monte que le panneau actif : une seule table à la fois. */}
          <TabsContent value="item">
            <ReportTable
              rows={byProduct}
              columns={itemColumns}
              sortSpecs={PVS_ITEM_SORT_SPECS}
              rowKey={(r) => r.product_id}
              caption="Production, sales and approved waste per item"
              showFooter={summary !== undefined}
              search={{ label: 'Search items', placeholder: 'Search items', noun: 'item', urlKey: SEARCH_KEY }}
              emptyText="No item."
              testId="pvs-table-item"
              onVisibleRowsChange={setVisibleItems}
            />
          </TabsContent>
          <TabsContent value="category">
            <ReportTable
              rows={byCategory}
              columns={categoryColumns}
              sortSpecs={PVS_CATEGORY_SORT_SPECS}
              rowKey={(r) => r.category_id}
              caption="Production, sales and approved waste per category"
              showFooter={summary !== undefined}
              emptyText="No category."
              testId="pvs-table-category"
              onVisibleRowsChange={setVisibleCategories}
            />
          </TabsContent>
          <TabsContent value="day">
            <ReportTable
              rows={byDay}
              columns={dayColumns}
              sortSpecs={PVS_DAY_SORT_SPECS}
              rowKey={(r) => r.date}
              caption="Production, sales and approved waste per day"
              showFooter={summary !== undefined}
              emptyText="No day."
              testId="pvs-table-day"
              onVisibleRowsChange={setVisibleDays}
            />
          </TabsContent>
        </Tabs>
      </PanelCard>

      <aside
        className="mt-3 rounded-sm border border-border-subtle bg-surface-4 px-3 py-2 text-xs text-text-secondary"
        aria-label="How to read this report"
        data-testid="pvs-reading-notes"
      >
        <p className="font-medium text-text-primary">Informational report: it does not change stock.</p>
        <ul className="mt-1 list-disc space-y-0.5 pl-4">
          <li>
            Unexplained = carried over + produced − sold − approved waste − left at close. The two counts come from
            the till&apos;s end-of-day display count; the latest correction counts.{' '}
            <Link
              to={LEFTOVERS_URL}
              className={cn('rounded-sm text-gold underline-offset-2 hover:underline', FOCUS_RING)}
              data-testid="pvs-leftovers-link"
            >
              Review end-of-day counts
            </Link>
          </li>
          <li>A missing count is shown as —, never as 0. A total marked &quot;partial&quot; leaves those item-days out.</li>
          <li>Counter sales count on the day they are recognised. B2B orders count on the day they are delivered, paid or on credit; an order not yet delivered does not count.</li>
          <li>An item sold as part of a combo is not counted as sold here. Promotional gifts are not counted either.</li>
          <li>Only approved waste counts. Waste entered in an end-of-day count is dated on that day; other waste on the day it was approved.</li>
          <li>The gap (produced − sold − waste) ignores what was carried over from the day before.</li>
          <li>Items on an order line cancelled after preparation are neither sold nor approved waste, so they stay in the gap.</li>
          <li>Only fresh daily items are covered: the categories listed in the Category filter.</li>
        </ul>
      </aside>

      <ProductionVsSalesItemDrawer
        item={openedRow}
        days={data?.by_day_product ?? []}
        start={servedStart}
        end={servedEnd}
        onClose={() => { setOpened(null); }}
      />
    </ReportShell>
  );
}
