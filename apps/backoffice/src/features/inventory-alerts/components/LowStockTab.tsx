// apps/backoffice/src/features/inventory-alerts/components/LowStockTab.tsx
// Session 13 / Phase 2.D — Low Stock tab content of AlertsPage.
//
// Refonte design 2026-08-08 — passe au DataTable partagé (en-tête sur
// remplissage inerte, libellés mono, état vide et squelettes corrects). Le
// contenu et la source de données sont inchangés.

import type { JSX } from 'react';
import { DataTable, type DataTableColumn } from '@breakery/ui';
import { useLowStock, type LowStockRow } from '../hooks/useLowStock.js';
import { ProductCell } from './ProductCell.js';

/** Une quantité de stock se lit en mono tabulaire, unité comprise. */
function qty(value: number, unit: string): JSX.Element {
  return (
    <span className="font-data text-[12.5px]">
      {Number(value)} <span className="text-text-muted">{unit}</span>
    </span>
  );
}

const COLUMNS: DataTableColumn<LowStockRow>[] = [
  {
    id: 'product',
    header: 'Product',
    render: (r) => <ProductCell productId={r.product_id} name={r.product_name} secondary={r.product_sku} />,
  },
  {
    id: 'section',
    header: 'Location',
    render: (r) => <span className="text-[12.5px] text-text-secondary">{r.section_name ?? '—'}</span>,
  },
  {
    id: 'current',
    header: 'On hand',
    align: 'right',
    // Un stock sous le seuil est la raison d'être de la ligne : il porte
    // l'alerte, les deux autres colonnes sont là pour la mesurer.
    render: (r) => <span className="text-danger">{qty(r.current_qty, r.unit)}</span>,
  },
  {
    id: 'threshold',
    header: 'Min',
    align: 'right',
    render: (r) => qty(r.min_stock_threshold, r.unit),
  },
  {
    id: 'shortfall',
    header: 'Shortfall',
    align: 'right',
    render: (r) => (
      <span className="font-data text-[12.5px] font-semibold">
        {Number(r.shortfall).toFixed(3)} <span className="font-normal text-text-muted">{r.unit}</span>
      </span>
    ),
  },
];

export function LowStockTab(): JSX.Element {
  const q = useLowStock(null);

  if (q.error !== null) {
    return <p className="text-sm text-danger" role="alert">Failed to load low stock: {q.error.message}</p>;
  }

  const rows = q.data ?? [];

  return (
    <DataTable<LowStockRow>
      columns={COLUMNS}
      rows={rows}
      getRowKey={(r) => r.product_id}
      isLoading={q.isLoading}
      density="compact"
      emptyTitle="All above threshold"
      emptyDescription="Every tracked product sits at or above its minimum."
      data-testid="low-stock-table"
      footer={
        <span className="font-data text-[11px] text-text-muted tabular-nums">
          {rows.length} {rows.length === 1 ? 'product' : 'products'}
        </span>
      }
    />
  );
}
