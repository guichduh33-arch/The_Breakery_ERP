// apps/backoffice/src/features/products/components/ProductsTable.tsx
//
// Écran 2a — table du catalogue, douze colonnes.
//
// Deux colonnes sont NEUVES et changent ce que la table sert à faire :
//
//   · Stock — `useProducts` renvoyait déjà `current_stock`, `unit`,
//     `min_stock_threshold` et `track_inventory` ; la table ne les montrait pas.
//     Aucune requête nouvelle, une colonne qui manquait.
//   · Margin — (retail − cost) / retail. Le catalogue affichait un coût et un
//     prix côte à côte en laissant le lecteur faire la division de tête, alors
//     que c'est le seul chiffre qui décide.
//
// Un coût MANQUANT se rend en rouge, et la marge en tiret : « marge nulle » et
// « marge inconnue » ne sont pas la même information, et les confondre ferait
// passer pour vendu à prix coûtant un produit dont on ignore le coût.
//
// La sélection et le pied d'actions groupées sont posés, mais les trois actions
// sont INERTES : elles réclament des RPC de masse gatées et auditées qui
// n'existent pas encore (arbitrage Mamat 2026-08-06). Elles sont visibles et
// désactivées plutôt qu'absentes, parce que la sélection multiple n'aurait
// aucun sens sans elles.

import { ChevronLeft, ChevronRight, DollarSign, Eye, Package, Trash2 } from 'lucide-react';
import type { JSX } from 'react';
import { Badge, DataTable, cn, type DataTableColumn } from '@breakery/ui';
import { ProductTypeBadge } from './ProductTypeBadge.js';
import {
  classifyProduct, productMarginPct,
  type ProductColumnId, type ProductRow,
} from '../types.js';

export const PRODUCTS_PAGE_SIZE = 15;

const MONO = 'font-data tabular-nums';
const DASH = <span className="text-text-subtle">—</span>;
const EMPTY_SELECTION: ReadonlySet<string> = new Set();

function num(v: number): string {
  return Math.round(v).toLocaleString('id-ID');
}

interface Props {
  rows: readonly ProductRow[];
  isLoading?: boolean;
  parentIds?: ReadonlySet<string>;
  hiddenColumns?: ReadonlySet<ProductColumnId>;
  /** Page courante, 1-based. La pagination est possédée par la page. */
  page?: number;
  onPage?: (next: number) => void;
  selected?: ReadonlySet<string>;
  onToggleRow?: (id: string) => void;
  onToggleAll?: (ids: readonly string[], allSelected: boolean) => void;
  onRowClick?: (row: ProductRow) => void;
  onView?:     (row: ProductRow) => void;
  onPricing?:  (row: ProductRow) => void;
  onDelete?:   (row: ProductRow) => void;
}

export function ProductsTable({
  rows,
  isLoading = false,
  parentIds,
  hiddenColumns,
  page = 1,
  onPage,
  selected = EMPTY_SELECTION,
  onToggleRow,
  onToggleAll,
  onRowClick,
  onView,
  onPricing,
  onDelete,
}: Props): JSX.Element {
  const total = rows.length;
  const pageCount = Math.max(1, Math.ceil(total / PRODUCTS_PAGE_SIZE));
  const current = Math.min(page, pageCount);
  const start = (current - 1) * PRODUCTS_PAGE_SIZE;
  const pageRows = rows.slice(start, start + PRODUCTS_PAGE_SIZE);
  const pageIds = pageRows.map((r) => r.id);
  const allOnPageSelected = pageIds.length > 0 && pageIds.every((id) => selected.has(id));

  const shown = (id: ProductColumnId): boolean => hiddenColumns?.has(id) !== true;

  const columns: DataTableColumn<ProductRow>[] = [
    {
      id: 'select',
      width: '28px',
      header: (
        <input
          type="checkbox"
          aria-label="Select all products on this page"
          checked={allOnPageSelected}
          onChange={() => { onToggleAll?.(pageIds, allOnPageSelected); }}
          onClick={(e) => { e.stopPropagation(); }}
          className="h-3.5 w-3.5 accent-gold"
        />
      ),
      render: (r) => (
        <input
          type="checkbox"
          aria-label={`Select ${r.name}`}
          checked={selected.has(r.id)}
          onChange={() => { onToggleRow?.(r.id); }}
          onClick={(e) => { e.stopPropagation(); }}
          className="h-3.5 w-3.5 accent-gold"
        />
      ),
    },
    {
      id: 'product',
      header: 'Product',
      width: '20.3%',
      render: (r) => (
        <div className={cn('flex items-center gap-2', r.parent_product_id !== null && 'pl-4')}>
          <span className="truncate font-medium text-text-primary">{r.name}</span>
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
      id: 'sku',
      header: 'SKU',
      width: '9.9%',
      render: (r) => <span className="font-data text-[11.5px] text-text-muted">{r.sku}</span>,
    },
    ...(shown('type') ? [{
      id: 'type',
      header: 'Type',
      width: '11.4%',
      render: (r: ProductRow) => <ProductTypeBadge type={classifyProduct(r)} />,
    }] : []),
    ...(shown('category') ? [{
      id: 'category',
      header: 'Category',
      width: '10.4%',
      // La pilule de catégorie tombe en vue liste : quinze pilules colorées
      // empilées font un vitrail où la couleur ne distingue plus rien.
      render: (r: ProductRow) =>
        r.category_name === null ? DASH : <span className="text-[12.5px] text-text-secondary">{r.category_name}</span>,
    }] : []),
    ...(shown('stock') ? [{
      id: 'stock',
      header: 'Stock',
      align: 'right' as const,
      width: '8.3%',
      render: (r: ProductRow) => {
        if (!r.track_inventory) return DASH;
        const qty = r.current_stock;
        const tone =
          qty <= 0 ? 'text-danger font-semibold'
            : qty <= r.min_stock_threshold ? 'text-warning font-semibold'
              : 'text-text-secondary';
        return (
          <span
            className={cn(MONO, 'whitespace-nowrap', tone)}
            {...(r.is_display_item
              ? { title: 'Display-case product — the POS sells off the vitrine counter, not this global stock.' }
              : {})}
          >
            {num(qty)} {r.unit}
          </span>
        );
      },
    }] : []),
    ...(shown('cost') ? [{
      id: 'cost',
      header: 'Cost',
      align: 'right' as const,
      width: '8.3%',
      // Coût manquant EN ROUGE : c'est la population du compteur « No cost
      // price », et la cause d'une marge qu'on ne peut pas calculer.
      render: (r: ProductRow) =>
        r.cost_price > 0
          ? <span className={cn(MONO, 'text-text-secondary')}>{num(r.cost_price)}</span>
          : <span className={cn(MONO, 'font-semibold text-danger')}>—</span>,
    }] : []),
    ...(shown('retail') ? [{
      id: 'retail',
      header: 'Retail',
      align: 'right' as const,
      width: '8.3%',
      render: (r: ProductRow) =>
        r.retail_price > 0
          ? <span className={cn(MONO, 'font-semibold text-gold')}>{num(r.retail_price)}</span>
          : DASH,
    }] : []),
    ...(shown('wholesale') ? [{
      id: 'wholesale',
      header: 'Wholesale',
      align: 'right' as const,
      width: '8.8%',
      render: (r: ProductRow) =>
        r.wholesale_price !== null && r.wholesale_price > 0
          ? <span className={cn(MONO, 'text-text-secondary')}>{num(r.wholesale_price)}</span>
          : DASH,
    }] : []),
    ...(shown('margin') ? [{
      id: 'margin',
      header: 'Margin',
      align: 'right' as const,
      width: '7.1%',
      // Marge NÉGATIVE en rouge, comme le coût manquant : un produit vendu à
      // perte rendait jusqu'ici en noir ordinaire, typographiquement identique à
      // un produit à 87 % de marge — seul le signe moins portait l'information.
      // Et aucun compteur ne l'attrape : « No cost price » teste `cost <= 0`,
      // pas `cost > retail`.
      render: (r: ProductRow) => {
        const m = productMarginPct(r);
        if (m === null) return DASH;
        const atALoss = m < 0;
        return (
          <span
            className={cn(MONO, atALoss ? 'font-semibold text-danger' : 'text-text-primary')}
            {...(atALoss ? { title: 'Sold below cost' } : {})}
          >
            {m.toLocaleString('id-ID', { minimumFractionDigits: 1, maximumFractionDigits: 1 })}%
          </span>
        );
      },
    }] : []),
    ...(shown('status') ? [{
      id: 'status',
      header: 'Status',
      align: 'center' as const,
      width: '7.1%',
      render: (r: ProductRow) => (
        <span className={cn('text-[11.5px] font-semibold', r.is_active ? 'text-success' : 'text-text-muted')}>
          {r.is_active ? 'Active' : 'Inactive'}
        </span>
      ),
    }] : []),
    {
      id: 'actions',
      header: 'Actions',
      align: 'right',
      width: '72px',
      render: (r) => (
        <div className="flex items-center justify-end gap-1.5">
          <RowAction label={`View ${r.name}`} onClick={(e) => { e.stopPropagation(); onView?.(r); }}>
            <Eye className="h-3.5 w-3.5" aria-hidden />
          </RowAction>
          {onPricing !== undefined && (
            <RowAction
              label={`Edit pricing for ${r.name}`}
              onClick={(e) => { e.stopPropagation(); onPricing(r); }}
              data-testid={`pricing-btn-${r.id}`}
            ><DollarSign className="h-3.5 w-3.5" aria-hidden /></RowAction>
          )}
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

  const from = total === 0 ? 0 : start + 1;
  const to = Math.min(start + PRODUCTS_PAGE_SIZE, total);

  const footer = (
    <div className="flex flex-wrap items-center gap-3.5">
      <span className="text-[12.5px] text-text-secondary">
        {selected.size > 0 ? `${selected.size} selected` : 'None selected'}
      </span>
      <BulkAction label="Change prices" disabled={selected.size === 0} />
      <BulkAction label="Move category" disabled={selected.size === 0} />
      <BulkAction label="Deactivate" disabled={selected.size === 0} />
      <span className="ml-auto font-data text-[11.5px] tabular-nums text-text-muted">
        {from}–{to} of {total.toLocaleString('id-ID')}
      </span>
      <div className="flex items-center gap-1">
        <PageButton label="Previous page" disabled={current <= 1} onClick={() => { onPage?.(current - 1); }}>
          <ChevronLeft className="h-[15px] w-[15px]" aria-hidden />
        </PageButton>
        <PageButton label="Next page" disabled={current >= pageCount} onClick={() => { onPage?.(current + 1); }}>
          <ChevronRight className="h-[15px] w-[15px]" aria-hidden />
        </PageButton>
      </div>
    </div>
  );

  const tableProps: Parameters<typeof DataTable<ProductRow>>[0] = {
    'data-testid': 'products-table',
    columns,
    rows: pageRows,
    getRowKey: (r) => r.id,
    isLoading,
    loadingRowCount: PRODUCTS_PAGE_SIZE,
    striped: false,
    density: 'compact',
    footer,
    rowClassName: (r) => (selected.has(r.id) ? 'bg-surface-inert' : undefined),
    emptyTitle: 'No products match these filters',
    emptyState: (
      <div className="flex flex-col items-center justify-center gap-2 py-16 text-center">
        <Package className="h-10 w-10 text-text-subtle" aria-hidden />
        <h3 className="text-base font-semibold text-text-primary">No products match these filters</h3>
        <p className="max-w-prose text-[13px] text-text-secondary">
          Clear a counter or widen the search to see the catalogue again.
        </p>
      </div>
    ),
  };
  if (onRowClick !== undefined) tableProps.onRowClick = onRowClick;
  return <DataTable {...tableProps} />;
}

function BulkAction({ label, disabled }: { label: string; disabled: boolean }): JSX.Element {
  return (
    <button
      type="button"
      disabled
      title="Bulk actions need dedicated gated RPCs — not wired yet."
      className={cn(
        'text-[12.5px] font-medium text-gold',
        'cursor-not-allowed opacity-50',
        disabled && 'opacity-30',
      )}
    >
      {label}
    </button>
  );
}

function PageButton({
  label, disabled, onClick, children,
}: {
  label: string;
  disabled: boolean;
  onClick: () => void;
  children: React.ReactNode;
}): JSX.Element {
  return (
    <button
      type="button"
      aria-label={label}
      disabled={disabled}
      onClick={onClick}
      className="inline-flex h-6 w-6 items-center justify-center rounded-sm text-text-muted transition-colors hover:bg-surface-4 hover:text-text-primary disabled:cursor-not-allowed disabled:opacity-30"
    >
      {children}
    </button>
  );
}

interface RowActionProps {
  label: string;
  onClick: (e: React.MouseEvent) => void;
  destructive?: boolean;
  'data-testid'?: string;
  children: React.ReactNode;
}

function RowAction({
  label, onClick, destructive = false, 'data-testid': testId, children,
}: RowActionProps): JSX.Element {
  return (
    <button
      type="button"
      aria-label={label}
      onClick={onClick}
      data-testid={testId}
      className={cn(
        'inline-flex h-6 w-6 items-center justify-center rounded-sm text-text-subtle transition-colors',
        'focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-gold',
        destructive ? 'hover:bg-red-soft hover:text-danger' : 'hover:bg-surface-4 hover:text-text-primary',
      )}
    >
      {children}
    </button>
  );
}
