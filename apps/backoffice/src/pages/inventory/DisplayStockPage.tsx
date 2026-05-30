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
import {
  useDisplayStock,
  type DisplayStockRow,
} from '@/features/inventory/hooks/useDisplayStock.js';
import {
  useDisplayMovements,
  type DisplayMovementRow,
} from '@/features/inventory/hooks/useDisplayMovements.js';

const STOCK_COLUMNS: ReadonlyArray<DataTableColumn<DisplayStockRow>> = [
  {
    id: 'product',
    header: 'Product',
    render: (r) => (
      <div className="space-y-0.5">
        <div className="font-medium text-text-primary">{r.product_name}</div>
        <div className="font-mono text-[11px] text-text-muted">{r.sku}</div>
      </div>
    ),
  },
  {
    id: 'quantity',
    header: 'Vitrine qty',
    align: 'right',
    width: '140px',
    render: (r) => (
      <span className="font-mono text-text-primary">
        {r.quantity} <span className="text-text-muted">{r.unit}</span>
      </span>
    ),
  },
  {
    id: 'updated',
    header: 'Last updated',
    width: '200px',
    render: (r) => (
      <span className="font-mono text-xs text-text-secondary whitespace-nowrap">
        {new Date(r.updated_at).toLocaleString()}
      </span>
    ),
  },
];

const MOVEMENT_COLUMNS: ReadonlyArray<DataTableColumn<DisplayMovementRow>> = [
  {
    id: 'when',
    header: 'When',
    width: '180px',
    render: (r) => (
      <span className="font-mono text-xs text-text-secondary whitespace-nowrap">
        {new Date(r.created_at).toLocaleString()}
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
      <span className="inline-flex items-center rounded-md border border-border-subtle bg-bg-base px-2 py-0.5 font-mono text-[11px] uppercase tracking-wide text-text-secondary">
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
        <span className={`font-mono ${positive ? 'text-success' : 'text-danger'}`}>
          {positive ? '+' : ''}{r.quantity}
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
      <header>
        <h1 className="font-display text-3xl text-text-primary">Display Stock (Vitrine)</h1>
        <p className="mt-1 text-sm text-text-secondary">
          Read-only view of the POS display-case counter. These quantities live on a
          separate ledger (display_stock) ; selling a display item draws from the
          vitrine, not the global BO inventory. Mutations happen from the POS side.
        </p>
      </header>

      <section className="space-y-3" aria-label="Display-stock counters">
        <h2 className="font-display text-xl text-text-primary">Current counters</h2>
        {stock.error !== null ? (
          <div role="alert" className="rounded-md border border-danger/40 bg-danger/5 p-3 text-sm text-danger">
            Failed to load display stock: {String(stock.error)}
          </div>
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
          <div role="alert" className="rounded-md border border-danger/40 bg-danger/5 p-3 text-sm text-danger">
            Failed to load display movements: {String(movements.error)}
          </div>
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
