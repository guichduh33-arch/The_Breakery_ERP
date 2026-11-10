// apps/backoffice/src/features/reports/components/salesByProductColumns.tsx
//
// S3-22 — la définition de la table « Product detail » de Sales by Product,
// sortie de la page pour qu'elle reste sous 500 lignes. Mêmes colonnes, mêmes
// cellules et même pied qu'avant la migration vers `ReportTable`.

import type { JSX } from 'react';
import { Link } from 'react-router-dom';
import { cn } from '@breakery/ui';
import { FOCUS_RING } from '@/components/focusRing.js';
import type { ReportColumn } from './ReportTable.js';
import type { SortSpec } from '../hooks/useSortedRows.js';
import type { SalesByProductSummary, SalesProductRow } from '../hooks/useSalesByProduct.js';
import { buildDrilldownUrl } from '../utils/buildDrilldownUrl.js';
import { formatIdrFull } from '../utils/chartColors.js';
import { formatCount, formatPct1 } from '../utils/reportFigures.js';

export type SalesByProductSortKey =
  | 'name' | 'category' | 'qty' | 'revenue' | 'discount'
  | 'avg' | 'share' | 'counter' | 'b2b';

/** Défini au niveau module : le hook le met en dépendance du tri, une identité
 *  neuve à chaque rendu retrierait sans fin. */
export const SALES_BY_PRODUCT_SORT_SPECS:
Readonly<Record<SalesByProductSortKey, SortSpec<SalesProductRow>>> = {
  name:     { kind: 'string', value: (r) => r.name },
  category: { kind: 'string', value: (r) => r.category_name },
  qty:      { kind: 'number', value: (r) => r.qty },
  revenue:  { kind: 'number', value: (r) => r.revenue },
  discount: { kind: 'number', value: (r) => r.discount },
  avg:      { kind: 'number', value: (r) => r.avg_price },
  share:    { kind: 'number', value: (r) => r.share_pct },
  counter:  { kind: 'number', value: (r) => r.counter.revenue },
  b2b:      { kind: 'number', value: (r) => r.b2b.revenue },
};

function dashIfZero(amount: number, text: string): JSX.Element | string {
  return amount > 0 ? text : <span className="text-text-subtle">—</span>;
}

export interface SalesByProductColumnsArgs {
  /** `undefined` pendant un chargement : pied vide. */
  summary: SalesByProductSummary | undefined;
  start:   string;
  end:     string;
  /** Ouvre le tiroir des lignes de vente du produit. */
  onOpen:  (product: { id: string; name: string }) => void;
}

export function buildSalesByProductColumns({
  summary, start, end, onOpen,
}: SalesByProductColumnsArgs): readonly ReportColumn<SalesProductRow, SalesByProductSortKey>[] {
  return [
    {
      id: 'name', header: 'Product', sortKey: 'name',
      searchText: (r) => r.name,
      // Le drill-down de CE rapport, ce sont les lignes de vente — pas la
      // fiche produit, qui vit dans le tiroir.
      cell: (r) => (
        <button
          type="button"
          onClick={() => { onOpen({ id: r.product_id, name: r.name }); }}
          data-testid={`open-lines-${r.product_id}`}
          className={cn(
            'rounded-sm text-left text-gold underline-offset-2 hover:underline',
            FOCUS_RING,
          )}
        >
          {r.name}
        </button>
      ),
      footer: 'Total',
    },
    {
      id: 'category', header: 'Category', sortKey: 'category',
      className: 'text-text-secondary',
      cell: (r) => {
        const catUrl = r.category_id !== null
          ? buildDrilldownUrl('category', r.category_id, { date_from: start, date_to: end })
          : null;
        return catUrl !== null && r.category_name !== null ? (
          <Link
            to={catUrl}
            className={cn('underline-offset-2 hover:underline hover:text-gold', FOCUS_RING)}
          >
            {r.category_name}
          </Link>
        ) : (r.category_name ?? '—');
      },
    },
    {
      id: 'qty', header: 'Qty', sortKey: 'qty', align: 'right',
      cell: (r) => formatCount(r.qty),
      footer: summary !== undefined ? formatCount(summary.qty) : null,
    },
    {
      id: 'revenue', header: 'Revenue', sortKey: 'revenue', align: 'right',
      cell: (r) => formatIdrFull(r.revenue),
      footer: summary !== undefined ? formatIdrFull(summary.revenue) : null,
    },
    {
      id: 'share', header: 'Share', sortKey: 'share', align: 'right',
      cell: (r) => formatPct1(r.share_pct),
      footer: '100,0%',
    },
    {
      id: 'avg', header: 'Avg price', sortKey: 'avg', align: 'right',
      cell: (r) => formatIdrFull(r.avg_price),
      footer: summary !== undefined ? formatIdrFull(summary.avg_price) : null,
    },
    {
      id: 'discount', header: 'Discount', sortKey: 'discount', align: 'right',
      cell: (r) => dashIfZero(r.discount, `−${formatIdrFull(r.discount)}`),
      footer: summary !== undefined
        ? (summary.discount > 0 ? `−${formatIdrFull(summary.discount)}` : '—')
        : null,
    },
    {
      id: 'counter', header: 'Counter', sortKey: 'counter', align: 'right',
      cell: (r) => formatIdrFull(r.counter.revenue),
      footer: summary !== undefined ? formatIdrFull(summary.counter.revenue) : null,
    },
    {
      id: 'b2b', header: 'B2B', sortKey: 'b2b', align: 'right',
      cell: (r) => dashIfZero(r.b2b.revenue, formatIdrFull(r.b2b.revenue)),
      footer: summary !== undefined ? formatIdrFull(summary.b2b.revenue) : null,
    },
  ];
}
