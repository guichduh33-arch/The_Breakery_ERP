// apps/backoffice/src/pages/reports/SalesByCategoryPage.tsx
//
// Lot D (campagne Reports 2026-08-15) — vague Sales, page 2/6. Migrée sur le
// socle Report shell v2 (archétype maquette 4c, patron : DailySalesPage).
//
//  1. LE REMPLISSAGE OR EST PARTI (`fill="var(--gold-base)"`). L'or est une
//     encre de sens, jamais une série : le graphe passe par `PairedBarsChart`
//     et sa série normée.
//  2. La comparaison survit à la migration : elle était portée par
//     `DateRangePickerWithCompare` + une bande de deltas maison ; elle est
//     désormais sur CHAQUE tuile de la bande KPI, et en seconde série du graphe
//     quand le bouton « Compare » est actif. L'appariement se fait par
//     CATÉGORIE (`category_id`), jamais par rang : un classement qui bouge
//     comparerait deux catégories différentes.
//  3. La carte de ventilation totalise le jeu COMPLET et referme ses 100 % par
//     un reliquat « Others » — cinq lignes montrées ne font pas un total.
//
// S3-22 (2026-11-10) — chaque ligne de la table ouvre « Sales by Product »
// filtré sur sa catégorie, sur la même période (`category_id` / `start` / `end`,
// les clés que la page cible lit). Le lien du nom vers le catalogue reste.
//
// S3-22 (2026-11-11) — la page reçoit le socle de filtres : type de commande,
// moyen de paiement, table (mêmes clés d'URL et mêmes libellés que Sales by
// Product). Ils partent au classement ET à sa comparaison — même portée — et
// le lien « View products » les transporte, puisque la page cible lit les
// mêmes clés. La table passe sur `ReportTable` (tri opt-in, pied de total) ;
// sans recherche : une poignée de catégories se lit d'un coup d'œil.

import { useMemo, type JSX } from 'react';
import { Link } from 'react-router-dom';
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
import { PairedBarsChart } from '@/features/reports/components/charts/PairedBarsChart.js';
import { DrilldownLink } from '@/features/reports/components/DrilldownLink.js';
import { ReportFilterBar } from '@/features/reports/components/ReportFilterBar.js';
import { ReportTable, type ReportColumn } from '@/features/reports/components/ReportTable.js';
import {
  PaymentFilterNote, SALES_ORDER_FILTER_DEFS, toSalesOrderFilters,
} from '@/features/reports/components/salesOrderFilters.js';
import { useReportPeriod } from '@/features/reports/hooks/useReportPeriod.js';
import { useReportFilters } from '@/features/reports/hooks/useReportFilters.js';
import type { SortSpec } from '@/features/reports/hooks/useSortedRows.js';
import type { SalesOrderFilters } from '@/features/reports/utils/salesFilters.js';
import {
  useSalesByCategory, type SalesCategoryRow,
} from '@/features/reports/hooks/useSalesByCategory.js';
import { buildDrilldownUrl } from '@/features/reports/utils/buildDrilldownUrl.js';
import {
  CHART_1, TEXT_INERT, categoricalColor, formatIdrCompact, formatIdrFull,
} from '@/features/reports/utils/chartColors.js';
import {
  formatCount, formatPct1, pctChange, periodLabel, sharePct, topSlice,
} from '@/features/reports/utils/reportFigures.js';

const csvColumns: CsvColumn<SalesCategoryRow>[] = [
  { header: 'Category', accessor: (r) => r.category_name, format: 'text' },
  { header: 'Revenue',  accessor: (r) => r.total,         format: 'idr-round100' },
  { header: 'Qty',      accessor: (r) => r.qty,           format: 'number' },
];

const INK_LINK = 'text-gold underline-offset-2 hover:underline focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-gold';
/** Barres lisibles : au-delà, l'axe devient une frise illisible — la table dit
 *  le reste, et l'aside annonce la coupe. */
const MAX_BARS = 8;
const MAX_TICK_CHARS = 14;

interface KpiDescriptor {
  key: string; label: string; value: string;
  title?: string; delta?: number | null; note?: string;
}

function sumRows(rows: SalesCategoryRow[]): { total: number; qty: number } {
  return rows.reduce(
    (acc, r) => ({ total: acc.total + r.total, qty: acc.qty + r.qty }),
    { total: 0, qty: 0 },
  );
}

function truncate(s: string): string {
  return s.length > MAX_TICK_CHARS ? `${s.slice(0, MAX_TICK_CHARS - 1)}…` : s;
}

type SortKey = 'name' | 'total' | 'qty';

/** Niveau module : `useSortedRows` met les specs en dépendance du tri. La part
 *  suit le total — même ordre, une seule clé. */
const SORT_SPECS: Readonly<Record<SortKey, SortSpec<SalesCategoryRow>>> = {
  name:  { kind: 'string', value: (r) => r.category_name },
  total: { kind: 'number', value: (r) => r.total },
  qty:   { kind: 'number', value: (r) => r.qty },
};

interface ColumnsArgs {
  sums:         { total: number; qty: number };
  start:        string;
  end:          string;
  orderFilters: SalesOrderFilters;
}

function buildColumns({
  sums, start, end, orderFilters,
}: ColumnsArgs): readonly ReportColumn<SalesCategoryRow, SortKey>[] {
  return [
    {
      id: 'name', header: 'Category', sortKey: 'name',
      cell: (r) => {
        const url = buildDrilldownUrl('category', r.category_id, {
          date_from: start, date_to: end,
        });
        return url !== null
          ? <Link to={url} className={INK_LINK}>{r.category_name}</Link>
          : r.category_name;
      },
      footer: 'Total',
    },
    {
      id: 'total', header: 'Total', sortKey: 'total', align: 'right',
      cell: (r) => formatIdrFull(r.total),
      footer: formatIdrFull(sums.total),
    },
    {
      id: 'share', header: 'Share', align: 'right',
      cell: (r) => formatPct1(sharePct(r.total, sums.total)),
      footer: '100,0%',
    },
    {
      id: 'qty', header: 'Qty', sortKey: 'qty', align: 'right',
      cell: (r) => formatCount(r.qty),
      footer: formatCount(sums.qty),
    },
    {
      id: 'products', header: 'Products', className: 'pl-4',
      // S3-22 — descente d'un cran, même période et mêmes filtres de commande
      // (Sales by Product lit les mêmes clés d'URL) ; le nom, lui, garde son
      // lien vers la fiche catégorie du catalogue.
      cell: (r) => (
        <DrilldownLink
          entity="sales_by_product"
          id=""
          filter={{ category_id: r.category_id, start, end, ...orderFilters }}
          icon={false}
          label={<>View products<span className="sr-only"> sold in {r.category_name}</span></>}
        />
      ),
    },
  ];
}

export default function SalesByCategoryPage(): JSX.Element {
  // Les bornes portaient DÉJÀ les noms standards `start` / `end` : aucun repli
  // de nom n'est nécessaire ici (le drapeau `compare` devient `cmp`).
  const period = useReportPeriod();
  const { start, end, compareRange } = period;

  const filters = useReportFilters(SALES_ORDER_FILTER_DEFS);
  const { order_type: orderType, payment_method: paymentMethod, table_number: tableNumber } =
    filters.values;
  const orderFilters = useMemo<SalesOrderFilters>(() => toSalesOrderFilters({
    order_type: orderType, payment_method: paymentMethod, table_number: tableNumber,
  }), [orderType, paymentMethod, tableNumber]);

  // Courant et comparaison sous la MÊME portée : sinon chaque delta comparerait
  // un jeu filtré à un jeu entier.
  const current = useSalesByCategory(start, end, orderFilters);
  const compare = useSalesByCategory(compareRange.start, compareRange.end, orderFilters);

  const rows    = useMemo(() => current.data ?? [], [current.data]);
  const cmpRows = useMemo(() => compare.data ?? [], [compare.data]);

  const sorted = useMemo(
    () => rows.slice().sort((a, b) => b.total - a.total),
    [rows],
  );
  const sums     = useMemo(() => sumRows(rows), [rows]);
  const prevSums = useMemo(() => sumRows(cmpRows), [cmpRows]);

  const comparable = compare.data !== undefined ? prevSums : undefined;
  const hasCompare = period.compare && compare.data !== undefined;

  // Appariement par identité, jamais par rang.
  const chartData = useMemo(() => {
    const cmpMap = new Map(cmpRows.map((r) => [r.category_id, r.total]));
    return sorted.slice(0, MAX_BARS).map((r) => ({
      category: r.category_name,
      current:  r.total,
      compare:  cmpMap.get(r.category_id) ?? 0,
    }));
  }, [sorted, cmpRows]);

  const top = topSlice(sorted, (r) => r.total);
  const topRows: BreakdownRow[] = top.rows.map((r, i) => {
    const url = buildDrilldownUrl('category', r.category_id, { date_from: start, date_to: end });
    return {
      key:      r.category_id,
      label:    r.category_name,
      amount:   r.total,
      sharePct: sharePct(r.total, top.total),
      color:    categoricalColor(i),
      ...(url !== null ? { to: url } : {}),
    };
  });

  // Sans le reliquat, cinq segments sur une base entière laisseraient un vide
  // qui se lit comme une part manquante.
  const shownShare = topRows.reduce((s, r) => s + (r.sharePct ?? 0), 0);
  const segments: ShareSegment[] = [
    ...topRows.map((r) => ({ label: r.label, pct: r.sharePct ?? 0, color: r.color ?? CHART_1 })),
    ...(shownShare < 99.95 ? [{ label: 'Others', pct: 100 - shownShare, color: TEXT_INERT }] : []),
  ];

  const avgItem     = sums.qty > 0 ? sums.total / sums.qty : 0;
  const prevAvgItem = comparable !== undefined && comparable.qty > 0
    ? comparable.total / comparable.qty
    : undefined;
  const leader = sorted[0];

  const tiles: KpiDescriptor[] = [
    {
      key: 'revenue', label: 'Revenue',
      value: formatIdrCompact(sums.total), title: formatIdrFull(sums.total),
      delta: pctChange(sums.total, comparable?.total),
    },
    {
      key: 'items-sold', label: 'Items sold', value: formatCount(sums.qty),
      delta: pctChange(sums.qty, comparable?.qty),
    },
    {
      key: 'avg-item', label: 'Avg item price',
      value: formatIdrCompact(avgItem), title: formatIdrFull(avgItem),
      delta: pctChange(avgItem, prevAvgItem),
    },
    {
      key: 'categories', label: 'Categories', value: formatCount(rows.length),
      delta: pctChange(rows.length, comparable !== undefined ? cmpRows.length : undefined),
    },
    {
      // Une variation n'a pas de sens sur un NOM : la tuile porte la part.
      key: 'top-category', label: 'Top category',
      value: leader?.category_name ?? '—',
      note:  leader !== undefined
        ? `${formatPct1(sharePct(leader.total, sums.total))} of revenue`
        : 'no sale in this period',
    },
  ];

  const activeCount = Object.keys(filters.active).length;
  const meta = [
    periodLabel(start, end),
    `${formatCount(rows.length)} categor${rows.length === 1 ? 'y' : 'ies'}`,
    'revenue and quantity per product category',
    // Dans la ligne méta, donc dans l'annonce live de ReportShell : changer de
    // filtre réécrit les chiffres, et il faut le dire.
    ...(activeCount > 0 ? [`${activeCount} filter${activeCount === 1 ? '' : 's'} active`] : []),
  ].join(' · ');

  const columns = useMemo(
    () => buildColumns({ sums, start, end, orderFilters }),
    [sums, start, end, orderFilters],
  );

  const filterBar = (
    <ReportFilterBar
      defs={SALES_ORDER_FILTER_DEFS}
      filters={filters}
      note={paymentMethod !== '' ? <PaymentFilterNote /> : undefined}
    />
  );

  const toolbar = (
    <>
      <PeriodControl period={period} showCompare />
      <ExportMenu
        csv={{ rows, columns: csvColumns, filename: `sales-by-category-${start}_${end}` }}
        pdf={{
          template: 'sales_by_category',
          data:     rows,
          period:   { start, end },
          filename: `sales-by-category-${start}_${end}`,
          ...(hasCompare ? { comparePrevious: { data: cmpRows } } : {}),
        }}
        disabled={rows.length === 0}
      />
    </>
  );

  return (
    <ReportShell
      title="Sales by Category"
      subtitle={meta}
      breadcrumb={[{ label: 'Reports', to: '/backoffice/reports' }, { label: 'Sales' }]}
      toolbar={toolbar}
      filters={filterBar}
      error={current.error}
      isEmpty={!current.isLoading && current.data !== undefined && rows.length === 0}
      emptyState={{
        title: 'No sales', description: 'No sales in the selected date range and filters.',
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
      <div className="grid gap-3 xl:grid-cols-[1.7fr_1fr]">
        <PanelCard
          title="Revenue by category"
          aside={sorted.length > MAX_BARS ? (
            <span className="text-xs text-text-muted">
              Top {MAX_BARS} of {formatCount(sorted.length)}
            </span>
          ) : undefined}
          isLoading={current.isLoading}
          testId="chart-revenue-by-category"
        >
          <PairedBarsChart
            data={chartData}
            xKey="category"
            currentKey="current"
            currentName="This period"
            {...(hasCompare ? { compareKey: 'compare', compareName: 'Previous period' } : {})}
            xTickFormatter={(v) => truncate(String(v))}
            xTickAngle={-25}
            ariaLabel={`Revenue per product category from ${start} to ${end}${hasCompare ? ', compared with the previous period' : ''}.`}
          />
        </PanelCard>
        <BreakdownCard
          title="Category share"
          subtitle={top.note}
          variant="track"
          rows={topRows}
          total={{ label: 'Total', amount: top.total }}
          isLoading={current.isLoading}
          error={current.error}
          shareBar={{
            title:     'Share of revenue',
            ariaLabel: 'Share of revenue by category',
            segments,
          }}
          shareBarPlacement="after-total"
          testId="breakdown-categories"
        />
      </div>

      <PanelCard
        title="Category detail"
        className="mt-3"
        isLoading={current.isLoading}
        testId="sbc-category-detail"
      >
        <ReportTable
          rows={sorted}
          columns={columns}
          sortSpecs={SORT_SPECS}
          rowKey={(r) => r.category_id}
          caption="Revenue and quantity per product category"
          showFooter
          emptyText="No category sold."
          testId="sbc-table"
        />
      </PanelCard>
    </ReportShell>
  );
}
