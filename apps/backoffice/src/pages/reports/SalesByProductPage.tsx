// apps/backoffice/src/pages/reports/SalesByProductPage.tsx
//
// « Sales by Product » — le détail des produits vendus. Famille Sales, archétype
// Report (DESIGN.md, maquette 4c), socle Report shell v2 ; patron :
// SalesByCategoryPage, dont cette page est la descente d'un cran (la catégorie
// répondait « quel rayon », celle-ci répond « quel produit »).
//
// TROIS CHOSES QUE CETTE PAGE DIT ET QU'AUCUNE AUTRE NE DISAIT :
//
//  1. LE CANAL EST VENTILÉ. Le rapport POS « Top products » exclut le B2B ; ici
//     il est compté ET séparé, sinon un produit vendu surtout en gros
//     s'afficherait mort. L'écart entre les deux écrans s'explique alors de
//     lui-même : la colonne comptoir est lisible à côté du total.
//  2. LES REMISES SONT DITES À LEUR PLACE. `revenue` est DÉJÀ net de la remise de
//     LIGNE — la colonne « Discount » dit ce qui a été consenti par-dessus. La
//     remise de COMMANDE et le total promo, eux, ne sont ventilés sur aucune
//     ligne par le schéma : ils sortent dans l'encart de réserves, jamais dans
//     une colonne produit qui les ferait passer pour attribués.
//  3. CHAQUE LIGNE EST REMONTABLE. Un clic sur un produit ouvre ses lignes de
//     vente — heure, n° de commande, client, quantité, remise (principe produit
//     n° 3 : un chiffre sans son origine est inutile).
//
// Le graphe est un PARETO : « qu'est-ce qui porte le chiffre d'affaires ». La
// courbe cumule la MÊME unité que les barres et son pourcentage se rapporte au
// jeu COMPLET, pas aux seules barres montrées — sinon douze produits sur
// quatre-vingts refermeraient la courbe à 100 %, ce qui dirait « ces douze font
// tout le chiffre ».
//
// S3-22 (2026-11-10) — page témoin du socle de filtres : `ReportFilterBar`
// (catégorie, type de commande, moyen de paiement, table — tous dans l'URL) et
// `ReportTable` (tri + recherche client sur le nom). Les trois filtres de
// commande partent au classement ET au tiroir : même portée, mêmes totaux. La
// recherche ne touche ni les KPI, ni les graphes, ni l'export : c'est une
// loupe sur la table, pas un filtre du rapport.

import { useMemo, useState, type JSX } from 'react';
import { useAuthStore } from '@/stores/authStore.js';
import { useProductSalesVisibilityRealtime } from '@/features/reports/hooks/useProductSalesVisibilityRealtime.js';
import type { CsvColumn } from '@breakery/domain';
import { PanelCard } from '@/components/PanelCard.js';
import { KpiTile, KPI_NOTE, KPI_NOTE_HERO } from '@/components/kpi/KpiTile.js';
import { Delta } from '@/components/kpi/Delta.js';
import { ReportShell } from '@/features/reports/components/ReportShell.js';
import { KpiBand } from '@/features/reports/components/KpiBand.js';
import { PeriodControl } from '@/features/reports/components/PeriodControl.js';
import { ExportMenu } from '@/features/reports/components/ExportMenu.js';
import { ReportFilterBar } from '@/features/reports/components/ReportFilterBar.js';
import { ReportTable } from '@/features/reports/components/ReportTable.js';
import {
  SALES_BY_PRODUCT_SORT_SPECS, buildSalesByProductColumns,
} from '@/features/reports/components/salesByProductColumns.js';
import {
  BreakdownCard, type BreakdownRow, type ShareSegment,
} from '@/features/reports/components/BreakdownCard.js';
import { ParetoChart } from '@/features/reports/components/charts/ParetoChart.js';
import {
  ProductSalesLinesDrawer,
} from '@/features/reports/components/ProductSalesLinesDrawer.js';
import { useReportPeriod } from '@/features/reports/hooks/useReportPeriod.js';
import {
  useReportFilters, type ReportFilterDef,
} from '@/features/reports/hooks/useReportFilters.js';
import {
  PaymentFilterNote, SALES_ORDER_FILTER_DEFS, toSalesOrderFilters, type SalesOrderFilterKey,
} from '@/features/reports/components/salesOrderFilters.js';
import {
  useSalesByProduct, type SalesProductRow,
} from '@/features/reports/hooks/useSalesByProduct.js';
import type { SalesOrderFilters } from '@/features/reports/utils/salesFilters.js';
import { useAllCategories } from '@/features/categories/hooks/useAllCategories.js';
import {
  CHART_1, CHART_3, formatIdrCompact, formatIdrFull,
} from '@/features/reports/utils/chartColors.js';
import {
  formatCount, formatPct1, pctChange, periodLabel, sharePct,
} from '@/features/reports/utils/reportFigures.js';

const csvColumns: CsvColumn<SalesProductRow>[] = [
  { header: 'Product',         accessor: (r) => r.name,                  format: 'text' },
  { header: 'Category',        accessor: (r) => r.category_name ?? '',   format: 'text' },
  { header: 'Qty',             accessor: (r) => r.qty,                   format: 'number' },
  { header: 'Revenue (net)',   accessor: (r) => r.revenue,               format: 'idr-round100' },
  { header: 'Line discount',   accessor: (r) => r.discount,              format: 'idr-round100' },
  { header: 'Avg price',       accessor: (r) => r.avg_price,             format: 'idr-round100' },
  { header: 'Share %',         accessor: (r) => r.share_pct.toFixed(2),  format: 'text' },
  { header: 'Orders',          accessor: (r) => r.order_count,           format: 'number' },
  { header: 'Counter qty',     accessor: (r) => r.counter.qty,           format: 'number' },
  { header: 'Counter revenue', accessor: (r) => r.counter.revenue,       format: 'idr-round100' },
  { header: 'B2B qty',         accessor: (r) => r.b2b.qty,               format: 'number' },
  { header: 'B2B revenue',     accessor: (r) => r.b2b.revenue,           format: 'idr-round100' },
];

/** Au-delà, l'axe devient une frise illisible — la table dit le reste, et
 *  l'aside annonce la coupe. */
const MAX_BARS = 12;
const MAX_TICK_CHARS = 14;

function truncate(s: string): string {
  return s.length > MAX_TICK_CHARS ? `${s.slice(0, MAX_TICK_CHARS - 1)}…` : s;
}

type FilterKey = 'category_id' | SalesOrderFilterKey;

/** Clé d'URL de la recherche produit : « Clear filters » la vide aussi. */
const SEARCH_KEY = 'q';
const EXTRA_FILTER_KEYS: readonly string[] = [SEARCH_KEY];

interface KpiDescriptor {
  key: string; label: string; value: string;
  title?: string; delta?: number | null; note?: string;
}

export default function SalesByProductPage(): JSX.Element {
  const user = useAuthStore((state) => state.user);
  useProductSalesVisibilityRealtime(!!user);
  const period = useReportPeriod();
  const { start, end, compareRange } = period;

  // Le produit dont on lit les lignes. Local et non dans l'URL : c'est une
  // lecture transitoire, pas un état de la page qu'on partagerait par un lien.
  const [opened, setOpened] = useState<{ id: string; name: string } | null>(null);

  const { data: categories } = useAllCategories();

  const filterDefs = useMemo<readonly ReportFilterDef<FilterKey>[]>(() => [
    {
      kind: 'select', key: 'category_id', label: 'Category', allLabel: 'All categories',
      options: (categories ?? []).map((c) => ({ value: c.id, label: c.name })),
    },
    // Les trois filtres de commande, partagés avec Category et Staff.
    ...SALES_ORDER_FILTER_DEFS,
  ], [categories]);
  const filters = useReportFilters(filterDefs, { extraKeys: EXTRA_FILTER_KEYS });
  const categoryId = filters.values.category_id;
  const { order_type: orderType, payment_method: paymentMethod, table_number: tableNumber } =
    filters.values;

  const orderFilters = useMemo<SalesOrderFilters>(() => toSalesOrderFilters({
    order_type: orderType, payment_method: paymentMethod, table_number: tableNumber,
  }), [orderType, paymentMethod, tableNumber]);

  const current = useSalesByProduct({
    start, end, categoryId: categoryId || null, filters: orderFilters,
  });
  const compare = useSalesByProduct({
    start: compareRange.start, end: compareRange.end, categoryId: categoryId || null,
    filters: orderFilters,
  });

  const rows    = useMemo(() => current.isError || current.isFetching ? [] : current.data?.by_product ?? [], [current.data, current.isError, current.isFetching]);
  const summary = current.isError || current.isFetching ? undefined : current.data?.summary;
  const prev    = compare.isError || compare.isFetching ? undefined : compare.data?.summary;
  const comparable = compare.data !== undefined ? prev : undefined;

  // Le Pareto lit le classement PAR CHIFFRE D'AFFAIRES, jamais le tri courant de
  // la table : un tri par nom en ferait une frise sans pente, ce qui n'est plus
  // un Pareto.
  const chartRows = useMemo(
    () => rows.slice(0, MAX_BARS).map((r) => ({ product: r.name, revenue: r.revenue })),
    [rows],
  );

  // Ventilation par canal — la question que le périmètre de cette page ouvre.
  const channelRows: BreakdownRow[] = useMemo(() => {
    if (summary === undefined) return [];
    const total = summary.revenue;
    return [
      {
        key: 'counter', label: 'Counter', amount: summary.counter.revenue,
        sharePct: sharePct(summary.counter.revenue, total),
        color: CHART_1, count: `${formatCount(summary.counter.qty)} items`,
      },
      {
        key: 'b2b', label: 'B2B', amount: summary.b2b.revenue,
        sharePct: sharePct(summary.b2b.revenue, total),
        color: CHART_3, count: `${formatCount(summary.b2b.qty)} items`,
      },
    ];
  }, [summary]);

  const channelSegments: ShareSegment[] = channelRows.map((r) => ({
    label: r.label, pct: r.sharePct ?? 0, color: r.color ?? CHART_1,
  }));

  const leader = rows[0];
  const unattributed = (summary?.unattributed.order_discount ?? 0)
    + (summary?.unattributed.promotion_total ?? 0);

  const tiles: KpiDescriptor[] = [
    {
      key: 'revenue', label: 'Revenue',
      value: formatIdrCompact(summary?.revenue ?? 0), title: formatIdrFull(summary?.revenue ?? 0),
      delta: pctChange(summary?.revenue ?? 0, comparable?.revenue),
      note:  'net of line discounts',
    },
    {
      key: 'items-sold', label: 'Items sold',
      value: formatCount(summary?.qty ?? 0),
      delta: pctChange(summary?.qty ?? 0, comparable?.qty),
    },
    {
      key: 'products', label: 'Products sold',
      value: formatCount(summary?.products ?? 0),
      delta: pctChange(summary?.products ?? 0, comparable?.products),
    },
    {
      key: 'avg-item', label: 'Avg item price',
      value: formatIdrCompact(summary?.avg_price ?? 0),
      title: formatIdrFull(summary?.avg_price ?? 0),
      delta: pctChange(summary?.avg_price ?? 0, comparable?.avg_price),
    },
    {
      key: 'discounts', label: 'Line discounts',
      value: formatIdrCompact(summary?.discount ?? 0),
      title: formatIdrFull(summary?.discount ?? 0),
      // Taire le non-attribuable ferait lire cette tuile comme le total des
      // remises. Elle porte donc sa propre réserve.
      note: unattributed > 0
        ? `+ ${formatIdrCompact(unattributed)} not attributable`
        : 'attributable to a product',
    },
    {
      // Une variation n'a pas de sens sur un NOM : la tuile porte la part.
      key: 'top-product', label: 'Top product',
      value: leader?.name ?? '—',
      note: leader !== undefined
        ? `${formatPct1(leader.share_pct)} of revenue`
        : 'no sale in this period',
    },
  ];

  const activeCount = Object.keys(filters.active).length;
  const meta = [
    periodLabel(start, end),
    `${formatCount(rows.length)} product${rows.length === 1 ? '' : 's'}`,
    'counter and B2B, cancelled lines and promo gifts excluded',
    // Dans la ligne méta, donc dans l'annonce live de ReportShell : changer de
    // filtre réécrit les chiffres, et il faut le dire.
    ...(activeCount > 0 ? [`${activeCount} filter${activeCount === 1 ? '' : 's'} active`] : []),
  ].join(' · ');

  // `setOpened` est stable : seules les données du pied et la période font
  // varier la définition.
  const columns = useMemo(
    () => buildSalesByProductColumns({ summary, start, end, onOpen: setOpened }),
    [summary, start, end],
  );

  const filterBar = (
    <ReportFilterBar
      defs={filterDefs}
      filters={filters}
      note={paymentMethod !== '' ? <PaymentFilterNote /> : undefined}
    />
  );

  const toolbar = (
    <>
      <PeriodControl period={period} showCompare />
      <ExportMenu
        csv={{ rows, columns: csvColumns, filename: `sales-by-product-${start}_${end}` }}
        disabled={rows.length === 0 || current.isError || current.isFetching}
      />
    </>
  );

  return (
    <ReportShell
      title="Sales by Product"
      subtitle={meta}
      breadcrumb={[{ label: 'Reports', to: '/backoffice/reports' }, { label: 'Sales' }]}
      toolbar={toolbar}
      filters={filterBar}
      error={current.error}
      isEmpty={!current.isLoading && current.data !== undefined && rows.length === 0}
      emptyState={{
        title: 'No sales',
        description: 'No product was sold in the selected date range and filters.',
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
              {t.delta !== undefined && <Delta value={t.delta} period="prev" onInk={i === 0} />}
              {t.note !== undefined && (
                <span className={i === 0 ? KPI_NOTE_HERO : KPI_NOTE}>{t.note}</span>
              )}
            </KpiTile>
          ))}
        </KpiBand>
      }
    >
      {/* Les réserves ne sont pas des notes de bas de page : elles conditionnent
          la lecture de chaque chiffre de l'écran. */}
      <p
        className="rounded-sm border border-border-subtle bg-surface-4 px-3 py-2 text-xs text-text-secondary"
        data-testid="scope-caveat"
      >
        Revenue is <strong>net of line discounts</strong>.
        {unattributed > 0 && (
          <>
            {' '}Order-level discounts and promotions ({formatIdrFull(unattributed)}) are not
            attributable to a product and stay out of this table.
          </>
        )}
        {' '}A product sold as a component of a combo has no line of its own and is not counted
        here. Partial refunds are not deducted per product.
      </p>

      <div className="mt-3 grid gap-3 xl:grid-cols-[1.7fr_1fr]">
        <PanelCard
          title="Revenue concentration"
          aside={rows.length > MAX_BARS ? (
            <span className="text-xs text-text-muted">
              Top {MAX_BARS} of {formatCount(rows.length)}
            </span>
          ) : undefined}
          isLoading={current.isLoading}
          testId="chart-revenue-pareto"
        >
          <ParetoChart
            data={chartRows}
            xKey="product"
            valueKey="revenue"
            valueName="Revenue"
            grandTotal={summary?.revenue ?? 0}
            xTickFormatter={(v) => truncate(String(v))}
            ariaLabel={`Revenue per product, highest first, with the cumulative revenue over the whole period from ${start} to ${end}.`}
          />
        </PanelCard>
        <BreakdownCard
          title="Counter vs B2B"
          subtitle="Same lines, split by sales channel."
          variant="track"
          rows={channelRows}
          total={{ label: 'Total revenue', amount: summary?.revenue ?? 0 }}
          isLoading={current.isLoading}
          error={current.error}
          shareBar={{
            title:     'Share of revenue',
            ariaLabel: 'Share of revenue by sales channel',
            segments:  channelSegments,
          }}
          shareBarPlacement="after-total"
          emptyText="No sale to split for this period."
          testId="breakdown-channels"
        />
      </div>

      <PanelCard
        title="Product detail"
        aside={<span className="text-xs text-text-muted">Pick a product to see its sales</span>}
        className="mt-3"
        isLoading={current.isLoading}
        testId="sbp-product-detail"
      >
        <ReportTable
          rows={rows}
          columns={columns}
          sortSpecs={SALES_BY_PRODUCT_SORT_SPECS}
          rowKey={(r) => r.product_id}
          caption="Quantity, revenue and channel split per product"
          showFooter={summary !== undefined}
          search={{
            label: 'Search products', placeholder: 'Search products', noun: 'product', urlKey: SEARCH_KEY,
          }}
          emptyText="No product sold."
          testId="sbp-table"
        />
      </PanelCard>

      <ProductSalesLinesDrawer
        product={current.isError || current.isFetching ? null : opened}
        start={start}
        end={end}
        filters={orderFilters}
        onClose={() => { setOpened(null); }}
      />
    </ReportShell>
  );
}
