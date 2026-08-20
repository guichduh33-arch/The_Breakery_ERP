// apps/backoffice/src/pages/inventory/DisplayStockPage.tsx
//
// POS display-stock isolation (Wave 6 / Task 26) — read-only BO consultation
// page for the POS "vitrine" counter. Two sections:
//   1. Current display-stock counters (per product).
//   2. Recent display-movements ledger (last 200).
//
// No mutations — display stock is mutated from the POS side only. Gated by
// `display.read` at the route level.

import { type JSX } from 'react';
import { DataTable, type DataTableColumn } from '@breakery/ui';
import { formatDateTimeShortWita, formatQuantity } from '@breakery/utils';
import {
  useDisplayStock,
  type DisplayStockRow,
} from '@/features/inventory/hooks/useDisplayStock.js';
import {
  useDisplayMovements,
  type DisplayMovementRow,
} from '@/features/inventory/hooks/useDisplayMovements.js';
import { PageHeader } from '@/components/PageHeader.js';
import { QueryErrorBanner } from '@/components/QueryErrorBanner.js';
import { errorDetailText } from '@/components/errorDetailText.js';

const STOCK_COLUMNS: readonly DataTableColumn<DisplayStockRow>[] = [
  {
    id: 'product',
    header: 'Product',
    render: (r) => (
      <div className="space-y-0.5">
        <div className="font-medium text-text-primary">{r.product_name}</div>
        <div className="font-mono text-xs text-text-muted">{r.sku}</div>
      </div>
    ),
  },
  {
    id: 'quantity',
    header: 'Vitrine qty',
    align: 'right',
    width: '140px',
    render: (r) => (
      <span className="font-mono tabular-nums text-text-primary">{formatQuantity(r.quantity, r.unit)}</span>
    ),
  },
  {
    id: 'updated',
    header: 'Last updated',
    width: '200px',
    render: (r) => (
      <span className="font-mono text-xs text-text-secondary whitespace-nowrap">
        {formatDateTimeShortWita(r.updated_at)}
      </span>
    ),
  },
];

const MOVEMENT_COLUMNS: readonly DataTableColumn<DisplayMovementRow>[] = [
  {
    id: 'when',
    header: 'When',
    width: '180px',
    render: (r) => (
      <span className="font-mono text-xs text-text-secondary whitespace-nowrap">
        {formatDateTimeShortWita(r.created_at)}
      </span>
    ),
  },
  {
    id: 'product',
    header: 'Product',
    render: (r) => <span className="text-text-primary">{r.product_name}</span>,
  },
  {
    id: 'type',
    header: 'Type',
    width: '160px',
    render: (r) => (
      <span className="inline-flex items-center rounded-md border border-border-subtle bg-bg-base px-2 py-0.5 font-mono text-xs uppercase tracking-wide text-text-secondary">
        {r.movement_type.replace(/_/g, ' ')}
      </span>
    ),
  },
  {
    id: 'qty',
    header: 'Qty',
    align: 'right',
    width: '110px',
    render: (r) => {
      const positive = r.quantity > 0;
      return (
        // Le ledger vitrine ne transporte pas l'unité du produit : sans suffixe.
        <span className={`font-mono tabular-nums ${positive ? 'text-success' : 'text-danger'}`}>
          {positive ? '+' : ''}{formatQuantity(r.quantity, null)}
        </span>
      );
    },
  },
  {
    id: 'reason',
    header: 'Reason',
    render: (r) => (
      <span className="text-xs text-text-secondary line-clamp-1">{r.reason ?? ''}</span>
    ),
  },
];

export default function DisplayStockPage(): JSX.Element {
  const stock = useDisplayStock();
  const movements = useDisplayMovements();

  return (
    <div className="space-y-8">
      <PageHeader
        title="Display Stock (Vitrine)"
        subtitle="Read-only view of the POS display-case counter. These quantities live on a separate ledger (display_stock); selling a display item draws from the vitrine, not the global BO inventory. Mutations happen from the POS side."
      />

      <section className="space-y-3" aria-label="Display-stock counters">
        <h2 className="font-display text-xl text-text-primary">Current counters</h2>
        {stock.error !== null ? (
          <QueryErrorBanner
            detail={errorDetailText(stock.error)}
            onRetry={() => { void stock.refetch(); }}
            data-testid="display-stock-error"
          >
            Display-stock counters could not be loaded — the table is withheld
            rather than shown empty.
          </QueryErrorBanner>
        ) : (
          <DataTable
            data-testid="display-stock-table"
            columns={STOCK_COLUMNS}
            rows={stock.data ?? []}
            getRowKey={(r) => r.product_id}
            isLoading={stock.isLoading}
            emptyTitle="No display items yet"
            emptyDescription="Flag a product as a display-case item to start tracking its vitrine counter."
          />
        )}
      </section>

      <section className="space-y-3" aria-label="Display-movements ledger">
        <h2 className="font-display text-xl text-text-primary">Recent movements</h2>
        {movements.error !== null ? (
          <QueryErrorBanner
            detail={errorDetailText(movements.error)}
            onRetry={() => { void movements.refetch(); }}
            data-testid="display-movements-error"
          >
            Display movements could not be loaded — the ledger is withheld
            rather than shown empty.
          </QueryErrorBanner>
        ) : (
          <DataTable
            data-testid="display-movements-table"
            columns={MOVEMENT_COLUMNS}
            rows={movements.data ?? []}
            getRowKey={(r) => r.id}
            isLoading={movements.isLoading}
            emptyTitle="No movements yet"
            emptyDescription="Stock-in, sales, returns to kitchen, waste, and adjustments land here."
          />
        )}
      </section>
    </div>
  );
}
