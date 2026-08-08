// apps/backoffice/src/features/inventory-alerts/components/ProductionAlertsTab.tsx
// Session 13 / Phase 2.D — Production alerts tab.
//
// Lecteur mince de get_production_suggestions_v1 (migration Phase 2.A). La RPC
// peut ne pas exister ; on dégrade proprement vers une liste vide.
//
// Refonte design 2026-08-08 — DataTable partagé. La priorité passe d'un texte
// coloré à une pastille sur fond teinté : `bg-danger/15` ne produisait rien,
// les tokens du thème étant des `var()` auxquels Tailwind ne peut pas appliquer
// d'alpha. Les tokens `*-soft` existent précisément pour ça.

import type { JSX } from 'react';
import { DataTable, type DataTableColumn } from '@breakery/ui';
import {
  useProductionSuggestions,
  type ProductionSuggestion,
} from '../hooks/useProductionSuggestions.js';
import { ProductCell } from './ProductCell.js';

const PRIORITY_CLASS: Record<string, string> = {
  high:   'bg-danger-soft text-danger',
  medium: 'bg-warning-soft text-warning',
  low:    'bg-surface-4 text-text-secondary',
};

const COLUMNS: DataTableColumn<ProductionSuggestion>[] = [
  {
    id: 'product',
    header: 'Product',
    render: (r) => <ProductCell productId={r.product_id} name={r.product_name} secondary={r.product_sku} />,
  },
  {
    id: 'stock',
    header: 'On hand',
    align: 'right',
    render: (r) => <span className="font-data text-[12.5px]">{Number(r.current_stock)}</span>,
  },
  {
    id: 'avg_daily',
    header: 'Daily sales',
    align: 'right',
    render: (r) => <span className="font-data text-[12.5px]">{Number(r.avg_daily_sales).toFixed(2)}</span>,
  },
  {
    id: 'coverage',
    header: 'Coverage',
    align: 'right',
    render: (r) => (
      <span className="font-data text-[12.5px]">
        {r.days_of_stock === null ? '—' : `${Number(r.days_of_stock).toFixed(1)} d`}
      </span>
    ),
  },
  {
    id: 'produce',
    header: 'Produce',
    align: 'right',
    render: (r) => (
      <span className="font-data text-[12.5px] font-semibold">{Number(r.suggested_quantity).toFixed(2)}</span>
    ),
  },
  {
    id: 'priority',
    header: 'Priority',
    render: (r) => (
      <span
        className={`inline-flex rounded-sm px-2 py-0.5 font-data text-[10px] font-semibold uppercase tracking-widest ${
          PRIORITY_CLASS[r.priority] ?? PRIORITY_CLASS.low
        }`}
      >
        {r.priority}
      </span>
    ),
  },
];

export function ProductionAlertsTab(): JSX.Element {
  const q = useProductionSuggestions();
  const rows = q.data ?? [];

  return (
    <DataTable<ProductionSuggestion>
      columns={COLUMNS}
      rows={rows}
      getRowKey={(r) => r.product_id}
      isLoading={q.isLoading}
      density="compact"
      emptyTitle="Nothing to produce"
      emptyDescription="Either nothing needs production today, or the production module is not deployed."
      data-testid="production-alerts-table"
      footer={
        <span className="font-data text-[11px] text-text-muted tabular-nums">
          {rows.length} {rows.length === 1 ? 'suggestion' : 'suggestions'}
        </span>
      }
    />
  );
}
