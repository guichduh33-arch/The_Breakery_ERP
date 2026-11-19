// apps/backoffice/src/features/reports/components/purchaseItemsColumns.tsx
//
// S3-20 — la table « Articles » de Purchase Items, sur le socle `ReportTable`
// (tri + recherche client), sortie de la page pour qu'elle reste sous 500
// lignes. Le nom ouvre les lignes d'achat de l'article ; la fiche produit et la
// catégorie gardent leurs liens.
//
// La quantité est dite dans l'unité de BASE de l'article, celle sur laquelle le
// coût moyen est calculé. L'unité d'achat s'affiche à côté quand elle est
// unique ; « mixed » dit qu'un même article s'est acheté sous plusieurs unités.

import type { JSX } from 'react';
import { cn } from '@breakery/ui';
import { formatQuantity } from '@breakery/utils';
import { FOCUS_RING } from '@/components/focusRing.js';
import { Delta } from '@/components/kpi/Delta.js';
import type { ReportColumn } from './ReportTable.js';
import { DrilldownLink } from './DrilldownLink.js';
import type { SortSpec } from '../hooks/useSortedRows.js';
import type { PurchaseItemRow, PurchaseItemsSummary } from '../hooks/usePurchaseItems.js';
import { formatIdrFull } from '../utils/chartColors.js';
import { formatCount, formatPct1, pctChange } from '../utils/reportFigures.js';

export type PurchaseItemsSortKey =
  | 'name' | 'category' | 'qty' | 'value' | 'share' | 'avg'
  | 'previous' | 'orders' | 'suppliers' | 'received';

/** Niveau module : `useSortedRows` le porte dans ses dépendances. */
export const PURCHASE_ITEMS_SORT_SPECS:
Readonly<Record<PurchaseItemsSortKey, SortSpec<PurchaseItemRow>>> = {
  name:      { kind: 'string', value: (r) => r.product_name },
  category:  { kind: 'string', value: (r) => r.category_name },
  qty:       { kind: 'number', value: (r) => r.base_quantity },
  value:     { kind: 'number', value: (r) => r.value },
  share:     { kind: 'number', value: (r) => r.share_pct },
  avg:       { kind: 'number', value: (r) => r.avg_unit_cost },
  previous:  { kind: 'number', value: (r) => r.previous_value },
  orders:    { kind: 'number', value: (r) => r.po_count },
  suppliers: { kind: 'number', value: (r) => r.supplier_count },
  received:  { kind: 'date',   value: (r) => r.last_received_date },
};

const DASH = <span className="text-text-subtle">—</span>;

function unitNote(r: PurchaseItemRow): JSX.Element | null {
  if (r.purchase_unit === null) return <span className="block text-xs text-text-muted">mixed units</span>;
  if (r.purchase_unit === r.base_unit) return null;
  return <span className="block text-xs text-text-muted">bought in {r.purchase_unit}</span>;
}

export interface PurchaseItemsColumnsArgs {
  summary:  PurchaseItemsSummary | undefined;
  /** La comparaison n'a de sens que si la période précédente a été lue. */
  compare:  boolean;
  onOpen:   (product: { id: string; name: string }) => void;
}

export function buildPurchaseItemsColumns({
  summary, compare, onOpen,
}: PurchaseItemsColumnsArgs): readonly ReportColumn<PurchaseItemRow, PurchaseItemsSortKey>[] {
  return [
    {
      id: 'name', header: 'Article', sortKey: 'name',
      searchText: (r) => `${r.product_name} ${r.sku}`,
      cell: (r) => (
        <span>
          <button
            type="button"
            onClick={() => { onOpen({ id: r.product_id, name: r.product_name }); }}
            data-testid={`open-purchase-lines-${r.product_id}`}
            className={cn('rounded-sm text-left text-gold underline-offset-2 hover:underline', FOCUS_RING)}
          >
            {r.product_name}
          </button>
          <span className="block font-data text-xs text-text-muted">
            <DrilldownLink entity="product" id={r.product_id} label={r.sku || 'Product'} />
          </span>
        </span>
      ),
      footer: 'Total',
    },
    {
      id: 'category', header: 'Category', sortKey: 'category',
      className: 'text-text-secondary',
      cell: (r) => r.category_name ?? DASH,
    },
    {
      id: 'qty', header: 'Quantity', sortKey: 'qty', align: 'right',
      cell: (r) => (
        <span>
          {formatQuantity(r.base_quantity, r.base_unit)}
          {unitNote(r)}
        </span>
      ),
    },
    {
      id: 'value', header: 'Value', sortKey: 'value', align: 'right',
      cell: (r) => formatIdrFull(r.value),
      footer: summary !== undefined ? formatIdrFull(summary.total_value) : null,
    },
    {
      id: 'share', header: 'Share', sortKey: 'share', align: 'right',
      cell: (r) => formatPct1(r.share_pct),
    },
    {
      id: 'avg', header: 'Avg unit cost', sortKey: 'avg', align: 'right',
      cell: (r) => (r.avg_unit_cost === null ? DASH : (
        <span>
          {formatIdrFull(r.avg_unit_cost)}
          {r.base_unit !== null && <span className="block text-xs text-text-muted">per {r.base_unit}</span>}
        </span>
      )),
    },
    ...(compare ? [{
      id: 'previous', header: 'Previous period', sortKey: 'previous' as const, align: 'right' as const,
      cell: (r: PurchaseItemRow) => (
        <span>
          {r.previous_value > 0 ? formatIdrFull(r.previous_value) : DASH}
          <span className="block"><Delta value={pctChange(r.value, r.previous_value)} period="prev" /></span>
        </span>
      ),
      footer: summary !== undefined ? formatIdrFull(summary.previous_total_value) : null,
    }] : []),
    {
      id: 'orders', header: 'POs', sortKey: 'orders', align: 'right',
      cell: (r) => formatCount(r.po_count),
    },
    {
      id: 'suppliers', header: 'Suppliers', sortKey: 'suppliers', align: 'right',
      cell: (r) => formatCount(r.supplier_count),
    },
    {
      id: 'received', header: 'Last received', sortKey: 'received',
      className: 'whitespace-nowrap font-data text-xs text-text-secondary',
      cell: (r) => (r.last_received_date !== null ? r.last_received_date.slice(0, 10) : DASH),
    },
  ];
}
