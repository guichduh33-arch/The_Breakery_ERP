// apps/backoffice/src/features/products/components/ProductsTable.tsx
//
// Session 14 / Phase 4.B — Dense product catalog table.
// Mirrors `product page.jpg`: PRODUCT · SKU · TYPE · CATEGORY · COST · RETAIL ·
// WHOLESALE · STATUS · ACTIONS.
//
// Read-only data — write paths arrive when the product CRUD RPCs land.

import { Box, DollarSign, Eye, Trash2 } from 'lucide-react';
import type { JSX } from 'react';
import {
  AllergenBadge,
  Badge,
  Currency,
  DataTable,
  type AllergenType,
  type DataTableColumn,
} from '@breakery/ui';
import { CategoryChip } from './CategoryChip.js';
import { ProductTypeBadge } from './ProductTypeBadge.js';
import { classifyProduct, type ProductRow } from '../types.js';

interface Props {
  rows: ReadonlyArray<ProductRow>;
  isLoading?: boolean;
  /** Map<product_id, resolved-allergens> from `view_product_allergens_resolved`. */
  resolvedAllergens?: ReadonlyMap<string, ReadonlyArray<AllergenType>>;
  /** Session 27c — set of product ids that are parents (i.e. have variants). */
  parentIds?: ReadonlySet<string>;
  onRowClick?: (row: ProductRow) => void;
  onView?:     (row: ProductRow) => void;
  onPricing?:  (row: ProductRow) => void;
  onDelete?:   (row: ProductRow) => void;
}

export function ProductsTable({
  rows,
  isLoading = false,
  resolvedAllergens,
  parentIds,
  onRowClick,
  onView,
  onPricing,
  onDelete,
}: Props): JSX.Element {
  const columns: ReadonlyArray<DataTableColumn<ProductRow>> = [
    {
      id: 'product',
      header: 'Product',
      render: (r) => (
        <span className="font-display text-base text-text-primary">{r.name}</span>
      ),
    },
    {
      id: 'sku',
      header: 'SKU',
      render: (r) => (
        <span className="font-mono text-xs text-text-secondary">{r.sku}</span>
      ),
    },
    {
      id: 'type',
      header: 'Type',
      render: (r) => (
        <div className="flex flex-wrap items-center gap-1">
          <ProductTypeBadge type={classifyProduct(r)} />
          {r.parent_product_id !== null && (
            <Badge variant="outline" data-testid="badge-variant">Variant</Badge>
          )}
          {parentIds !== undefined && parentIds.has(r.id) && (
            <Badge variant="outline" data-testid="badge-parent">Parent</Badge>
          )}
        </div>
      ),
    },
    {
      id: 'category',
      header: 'Category',
      render: (r) =>
        r.category_name === null
          ? <span className="text-text-muted">—</span>
          : <CategoryChip name={r.category_name} />,
    },
    {
      id: 'cost',
      header: 'Cost',
      align: 'right',
      render: (r) =>
        r.cost_price === 0
          ? <span className="text-text-muted">—</span>
          : <span className="font-mono text-text-secondary">Rp {Math.round(r.cost_price).toLocaleString()}</span>,
    },
    {
      id: 'retail',
      header: 'Retail',
      align: 'right',
      render: (r) => <Currency amount={r.retail_price} emphasis="gold" />,
    },
    {
      id: 'wholesale',
      header: 'Wholesale',
      align: 'right',
      render: (r) =>
        r.wholesale_price === null || r.wholesale_price === 0
          ? <span className="text-text-muted">—</span>
          : <span className="font-mono text-text-secondary">Rp {Math.round(r.wholesale_price).toLocaleString()}</span>,
    },
    {
      id: 'status',
      header: 'Status',
      align: 'center',
      render: (r) => (
        <span
          className={
            r.is_active
              ? 'text-xs font-semibold text-success'
              : 'text-xs font-semibold text-text-muted'
          }
        >
          {r.is_active ? 'Active' : 'Inactive'}
        </span>
      ),
    },
    {
      id: 'allergens',
      header: 'Allergens',
      align: 'left',
      render: (r) => {
        const resolved = resolvedAllergens?.get(r.id) ?? [];
        if (resolved.length === 0) {
          return <span className="text-text-muted">—</span>;
        }
        return (
          <div className="flex flex-wrap gap-0.5" data-testid={`products-table-allergens-${r.id}`}>
            {resolved.map((a) => (
              <AllergenBadge key={a} allergen={a} size="sm" />
            ))}
          </div>
        );
      },
    },
    {
      id: 'actions',
      header: 'Actions',
      align: 'right',
      render: (r) => (
        <div className="flex items-center justify-end gap-1">
          <RowAction
            label={`View ${r.name}`}
            onClick={(e) => { e.stopPropagation(); onView?.(r); }}
          ><Eye className="h-3.5 w-3.5" aria-hidden /></RowAction>
          <RowAction
            label={`Edit pricing for ${r.name}`}
            onClick={(e) => { e.stopPropagation(); onPricing?.(r); }}
          ><DollarSign className="h-3.5 w-3.5" aria-hidden /></RowAction>
          {onDelete !== undefined && (
            <RowAction
              label={`Delete ${r.name}`}
              onClick={(e) => { e.stopPropagation(); onDelete(r); }}
              destructive
              data-testid={`delete-btn-${r.id}`}
            ><Trash2 className="h-3.5 w-3.5" aria-hidden /></RowAction>
          )}
        </div>
      ),
    },
  ];

  const tableProps: Parameters<typeof DataTable<ProductRow>>[0] = {
    'data-testid': 'products-table',
    columns,
    rows,
    getRowKey: (r) => r.id,
    isLoading,
    emptyTitle: 'No products yet',
    emptyDescription: 'Adjust your filters or create a new product to get started.',
    emptyState: (
      <div className="flex flex-col items-center justify-center gap-2 py-16 text-center">
        <Box className="h-12 w-12 text-text-muted" aria-hidden />
        <h3 className="font-display italic text-xl text-text-primary">No products yet</h3>
        <p className="max-w-prose text-sm text-text-secondary">
          Adjust your filters or create a new product to get started.
        </p>
      </div>
    ),
  };
  if (onRowClick !== undefined) tableProps.onRowClick = onRowClick;
  return <DataTable {...tableProps} />;
}

interface RowActionProps {
  label: string;
  onClick: (e: React.MouseEvent) => void;
  destructive?: boolean;
  'data-testid'?: string;
  children: React.ReactNode;
}

function RowAction({ label, onClick, destructive = false, 'data-testid': testId, children }: RowActionProps): JSX.Element {
  return (
    <button
      type="button"
      aria-label={label}
      onClick={onClick}
      data-testid={testId}
      className={
        destructive
          ? 'inline-flex h-7 w-7 items-center justify-center rounded-full text-text-muted hover:bg-red-soft hover:text-red focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-gold transition-colors'
          : 'inline-flex h-7 w-7 items-center justify-center rounded-full text-text-muted hover:bg-bg-overlay hover:text-text-primary focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-gold transition-colors'
      }
    >
      {children}
    </button>
  );
}
