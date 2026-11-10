// apps/backoffice/src/features/reports/components/productionVsSalesColumns.tsx
//
// S3-19 — les trois vues en table de « Production vs Sales » (article,
// catégorie, jour), sorties de la page pour qu'elle reste sous 500 lignes.
// Mêmes colonnes de mesure partout ; seul le libellé change. Le pied porte le
// `summary` de la RPC, jamais une somme des lignes affichées.
//
// L'écart NÉGATIF (vendu plus que produit ce jour-là : stock de la veille) se
// dit par le SIGNE et par un libellé accessible ; la teinte n'est qu'un renfort.

import type { JSX } from 'react';
import { cn } from '@breakery/ui';
import type { CsvColumn } from '@breakery/domain';
import { FOCUS_RING } from '@/components/focusRing.js';
import type { ReportColumn } from './ReportTable.js';
import type { SortSpec } from '../hooks/useSortedRows.js';
import type {
  ProductionVsSalesFigures, ProductionVsSalesSummary, PvsCategoryRow, PvsDayRow, PvsProductRow,
} from '../hooks/useProductionVsSales.js';
import { formatCount, formatPct1, longDate } from '../utils/reportFigures.js';

export type PvsMeasureKey =
  | 'produced' | 'sold_counter' | 'sold_b2b' | 'sold_total' | 'wasted' | 'gap' | 'sell_through';
export type PvsItemSortKey = PvsMeasureKey | 'name' | 'category';
export type PvsCategorySortKey = PvsMeasureKey | 'name';
export type PvsDaySortKey = PvsMeasureKey | 'date';

/** Taux d'écoulement d'une ligne : celui du serveur quand il le sert, sinon
 *  recalculé (la vue par jour ne le porte pas). `null` si rien n'est produit. */
export function sellThroughOf(r: ProductionVsSalesFigures & { sell_through_pct?: number | null }): number | null {
  if (r.sell_through_pct !== undefined) return r.sell_through_pct;
  return r.produced > 0 ? (100 * r.sold_total) / r.produced : null;
}

function measureSpecs<T extends ProductionVsSalesFigures>(): Record<PvsMeasureKey, SortSpec<T>> {
  return {
    produced:     { kind: 'number', value: (r) => r.produced },
    sold_counter: { kind: 'number', value: (r) => r.sold_counter },
    sold_b2b:     { kind: 'number', value: (r) => r.sold_b2b },
    sold_total:   { kind: 'number', value: (r) => r.sold_total },
    wasted:       { kind: 'number', value: (r) => r.wasted },
    gap:          { kind: 'number', value: (r) => r.gap },
    sell_through: { kind: 'number', value: (r) => sellThroughOf(r) },
  };
}

// Niveau module : `useSortedRows` porte les specs dans ses dépendances.
export const PVS_ITEM_SORT_SPECS: Readonly<Record<PvsItemSortKey, SortSpec<PvsProductRow>>> = {
  name:     { kind: 'string', value: (r) => r.product_name },
  category: { kind: 'string', value: (r) => r.category_name },
  ...measureSpecs<PvsProductRow>(),
};
export const PVS_CATEGORY_SORT_SPECS: Readonly<Record<PvsCategorySortKey, SortSpec<PvsCategoryRow>>> = {
  name: { kind: 'string', value: (r) => r.category_name },
  ...measureSpecs<PvsCategoryRow>(),
};
export const PVS_DAY_SORT_SPECS: Readonly<Record<PvsDaySortKey, SortSpec<PvsDayRow>>> = {
  date: { kind: 'string', value: (r) => r.date },
  ...measureSpecs<PvsDayRow>(),
};

/** L'écart signé. Le moins typographique (U+2212) et le libellé portent le sens. */
export function GapValue({ gap }: { gap: number }): JSX.Element {
  if (gap < 0) {
    return (
      <span
        className="font-semibold text-warning"
        title="Sold more than produced that day: earlier stock was sold."
        data-testid="gap-negative"
      >
        −{formatCount(Math.abs(gap))}
        <span className="sr-only"> (sold beyond output)</span>
      </span>
    );
  }
  return <>{formatCount(gap)}</>;
}

function measureColumns<T extends ProductionVsSalesFigures & { sell_through_pct?: number | null }>(
  summary: ProductionVsSalesSummary | undefined,
): ReportColumn<T, PvsMeasureKey>[] {
  const foot = (fn: (s: ProductionVsSalesSummary) => string | JSX.Element) =>
    (summary !== undefined ? fn(summary) : null);
  return [
    {
      id: 'produced', header: 'Produced', sortKey: 'produced', align: 'right',
      cell: (r) => formatCount(r.produced), footer: foot((s) => formatCount(s.produced)),
    },
    {
      id: 'sold_counter', header: 'Sold counter', sortKey: 'sold_counter', align: 'right',
      cell: (r) => formatCount(r.sold_counter), footer: foot((s) => formatCount(s.sold_counter)),
    },
    {
      id: 'sold_b2b', header: 'Sold B2B', sortKey: 'sold_b2b', align: 'right',
      cell: (r) => formatCount(r.sold_b2b), footer: foot((s) => formatCount(s.sold_b2b)),
    },
    {
      id: 'sold_total', header: 'Sold total', sortKey: 'sold_total', align: 'right',
      cell: (r) => formatCount(r.sold_total), footer: foot((s) => formatCount(s.sold_total)),
    },
    {
      id: 'wasted', header: 'Approved waste', sortKey: 'wasted', align: 'right',
      cell: (r) => formatCount(r.wasted), footer: foot((s) => formatCount(s.wasted)),
    },
    {
      id: 'gap', header: 'Gap', sortKey: 'gap', align: 'right',
      cell: (r) => <GapValue gap={r.gap} />, footer: foot((s) => <GapValue gap={s.gap} />),
    },
    {
      id: 'sell_through', header: 'Sell-through', sortKey: 'sell_through', align: 'right',
      cell: (r) => formatSellThrough(sellThroughOf(r)),
      footer: foot((s) => formatSellThrough(s.sell_through_pct)),
    },
  ];
}

export function formatSellThrough(v: number | null): string {
  return v === null ? '—' : formatPct1(v);
}

const LINK_BTN = cn('rounded-sm text-left text-gold underline-offset-2 hover:underline', FOCUS_RING);

export function buildPvsItemColumns(args: {
  summary:          ProductionVsSalesSummary | undefined;
  onOpen:           (product: { id: string; name: string }) => void;
  onCategoryFilter: (categoryId: string) => void;
}): readonly ReportColumn<PvsProductRow, PvsItemSortKey>[] {
  const { summary, onOpen, onCategoryFilter } = args;
  return [
    {
      id: 'name', header: 'Item', sortKey: 'name',
      searchText: (r) => r.product_name,
      cell: (r) => (
        <button
          type="button"
          onClick={() => { onOpen({ id: r.product_id, name: r.product_name }); }}
          className={LINK_BTN}
          data-testid={`open-item-${r.product_id}`}
        >
          {r.product_name}
        </button>
      ),
      footer: 'Total',
    },
    {
      id: 'category', header: 'Category', sortKey: 'category',
      className: 'text-text-secondary',
      cell: (r) => (
        <button
          type="button"
          onClick={() => { onCategoryFilter(r.category_id); }}
          className={cn('rounded-sm text-left underline-offset-2 hover:underline hover:text-gold', FOCUS_RING)}
          title="Filter the report on this category"
        >
          {r.category_name}
        </button>
      ),
    },
    ...measureColumns<PvsProductRow>(summary),
  ];
}

export function buildPvsCategoryColumns(args: {
  summary:          ProductionVsSalesSummary | undefined;
  onCategoryFilter: (categoryId: string) => void;
}): readonly ReportColumn<PvsCategoryRow, PvsCategorySortKey>[] {
  const { summary, onCategoryFilter } = args;
  return [
    {
      id: 'name', header: 'Category', sortKey: 'name',
      cell: (r) => (
        <button
          type="button"
          onClick={() => { onCategoryFilter(r.category_id); }}
          className={LINK_BTN}
          title="Filter the report on this category"
          data-testid={`filter-category-${r.category_id}`}
        >
          {r.category_name}
        </button>
      ),
      footer: 'Total',
    },
    ...measureColumns<PvsCategoryRow>(summary),
  ];
}

export function buildPvsDayColumns(args: {
  summary: ProductionVsSalesSummary | undefined;
}): readonly ReportColumn<PvsDayRow, PvsDaySortKey>[] {
  return [
    {
      id: 'date', header: 'Day', sortKey: 'date',
      className: 'whitespace-nowrap font-data',
      cell: (r) => longDate(r.date),
      footer: 'Total',
    },
    ...measureColumns<PvsDayRow>(args.summary),
  ];
}

// --- CSV : les mêmes colonnes que la vue affichée ----------------------------

function measureCsv<T extends ProductionVsSalesFigures & { sell_through_pct?: number | null }>(): CsvColumn<T>[] {
  return [
    { header: 'Produced',       accessor: (r) => r.produced,     format: 'number' },
    { header: 'Sold counter',   accessor: (r) => r.sold_counter, format: 'number' },
    { header: 'Sold B2B',       accessor: (r) => r.sold_b2b,     format: 'number' },
    { header: 'Sold total',     accessor: (r) => r.sold_total,   format: 'number' },
    { header: 'Approved waste', accessor: (r) => r.wasted,       format: 'number' },
    { header: 'Gap',            accessor: (r) => r.gap,          format: 'number' },
    {
      header: 'Sell-through %',
      accessor: (r) => { const v = sellThroughOf(r); return v === null ? '' : v.toFixed(1); },
      format: 'text',
    },
  ];
}

export const PVS_ITEM_CSV: CsvColumn<PvsProductRow>[] = [
  { header: 'Item',     accessor: (r) => r.product_name,  format: 'text' },
  { header: 'Category', accessor: (r) => r.category_name, format: 'text' },
  ...measureCsv<PvsProductRow>(),
];
export const PVS_CATEGORY_CSV: CsvColumn<PvsCategoryRow>[] = [
  { header: 'Category', accessor: (r) => r.category_name, format: 'text' },
  ...measureCsv<PvsCategoryRow>(),
];
export const PVS_DAY_CSV: CsvColumn<PvsDayRow>[] = [
  { header: 'Day', accessor: (r) => r.date, format: 'text' },
  ...measureCsv<PvsDayRow>(),
];
