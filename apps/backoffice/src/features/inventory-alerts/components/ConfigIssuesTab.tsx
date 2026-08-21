// apps/backoffice/src/features/inventory-alerts/components/ConfigIssuesTab.tsx
// Audit 2026-07-08 — onglet « Product config » de AlertsPage.
// Liste les produits dont track_inventory/deduct_stock + recette ne déduisent
// pas le stock attendu à la vente.
//
// Refonte design 2026-08-08 — DataTable partagé. Deux corrections au passage :
// `bg-bg-subtle` n'existe pas dans le preset, et `bg-danger/15` ne produisait
// rien (les tokens du thème sont des `var()`, Tailwind ne peut pas leur
// appliquer d'alpha — d'où les tokens `*-soft`).

import type { JSX } from 'react';
import { DataTable, type DataTableColumn } from '@breakery/ui';
import {
  useStockConfigIssues,
  type StockConfigIssueRow,
  type StockConfigIssueType,
} from '../hooks/useStockConfigIssues.js';
import { ProductCell } from './ProductCell.js';

const ISSUE_LABEL: Record<StockConfigIssueType, { title: string; hint: string }> = {
  negative_stock: {
    title: 'Negative stock',
    hint: 'Tracked product sold with no stock — receive it (purchase) or produce it.',
  },
  sale_deduct_no_recipe: {
    title: 'No recipe',
    hint: 'Made to order (untracked) but has no recipe → deducts nothing on sale.',
  },
  orphan_recipe: {
    title: 'Orphan recipe',
    hint: 'Recipe defined but “Deduct stock” is off → never consumed.',
  },
  tracked_recipe_at_prod: {
    title: 'Recipe at production',
    hint: 'Tracked product: the recipe only deducts at production (record_production), not on sale.',
  },
};

function severityClass(sev: StockConfigIssueRow['severity']): string {
  if (sev === 'critical') return 'bg-danger-soft text-danger';
  // `warning` prenait l'or (`bg-gold-soft text-gold`) là où ses deux voisines
  // prennent leur token sémantique. L'or est une encre de sens dans le
  // back-office, il ne remplit pas une pastille de sévérité (DESIGN.md,
  // Ink-Not-Gold) — et `warning-soft` existe pour ce rôle exact.
  if (sev === 'warning') return 'bg-warning-soft text-warning';
  return 'bg-surface-4 text-text-secondary';
}

/** Un drapeau de config barré quand il est éteint — l'état se lit sans légende. */
function flag(label: string, on: boolean): JSX.Element {
  return (
    <span className={on ? 'text-text-primary' : 'text-text-muted line-through'}>{label}</span>
  );
}

const COLUMNS: DataTableColumn<StockConfigIssueRow>[] = [
  {
    id: 'product',
    header: 'Product',
    render: (r) => <ProductCell productId={r.product_id} name={r.name} secondary={r.category_name ?? r.sku} />,
  },
  {
    id: 'issue',
    header: 'Issue',
    render: (r) => {
      const label = ISSUE_LABEL[r.issue_type];
      return (
        <div className="max-w-md">
          <span
            className={`inline-flex rounded-sm px-2 py-0.5 font-data text-xs font-semibold uppercase tracking-widest ${severityClass(r.severity)}`}
          >
            {label.title}
          </span>
          <p className="mt-1 text-xs text-text-muted">{label.hint}</p>
        </div>
      );
    },
  },
  {
    id: 'config',
    header: 'Config',
    render: (r) => (
      <span className="font-data text-xs">
        {flag('track', r.track_inventory)}
        <span className="text-text-subtle" aria-hidden> · </span>
        {flag('deduct', r.deduct_stock)}
      </span>
    ),
  },
  {
    id: 'recipe_lines',
    header: 'Recipe',
    align: 'right',
    render: (r) => <span className="font-data text-xs">{r.recipe_lines}</span>,
  },
  {
    id: 'stock',
    header: 'Stock',
    align: 'right',
    render: (r) => (
      <span className={`font-data text-xs ${Number(r.current_stock) < 0 ? 'font-semibold text-danger' : ''}`}>
        {Number(r.current_stock)}
      </span>
    ),
  },
];

export function ConfigIssuesTab(): JSX.Element {
  const q = useStockConfigIssues();

  if (q.error !== null) {
    return <p className="text-sm text-danger" role="alert">Failed to load config issues: {q.error.message}</p>;
  }

  const rows = q.data ?? [];

  return (
    <DataTable<StockConfigIssueRow>
      caption="Product, issue, configuration, recipe and stock status per misconfigured product"
      columns={COLUMNS}
      rows={rows}
      getRowKey={(r) => `${r.product_id}-${r.issue_type}`}
      isLoading={q.isLoading}
      density="compact"
      emptyTitle="No misconfigured product"
      emptyDescription="Stock tracking, deduction and recipes agree everywhere."
      data-testid="config-issues-table"
      footer={
        <span className="font-data text-xs text-text-muted tabular-nums">
          {rows.length} {rows.length === 1 ? 'product' : 'products'}
        </span>
      }
    />
  );
}
