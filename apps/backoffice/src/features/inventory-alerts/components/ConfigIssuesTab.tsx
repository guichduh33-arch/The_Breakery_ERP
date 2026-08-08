// apps/backoffice/src/features/inventory-alerts/components/ConfigIssuesTab.tsx
// Audit 2026-07-08 — onglet « Config produit » de AlertsPage.
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
    title: 'Stock négatif',
    hint: 'Produit suivi vendu sans stock — à recevoir (achat) ou produire.',
  },
  sale_deduct_no_recipe: {
    title: 'Sans recette',
    hint: 'Fait-à-la-commande (non suivi) mais aucune recette → ne déduit rien à la vente.',
  },
  orphan_recipe: {
    title: 'Recette orpheline',
    hint: 'Recette définie mais « Deduct stock » désactivé → jamais consommée.',
  },
  tracked_recipe_at_prod: {
    title: 'Recette à la production',
    hint: 'Produit suivi : la recette ne déduit qu’à la production (record_production), pas à la vente.',
  },
};

function severityClass(sev: StockConfigIssueRow['severity']): string {
  if (sev === 'critical') return 'bg-danger-soft text-danger';
  if (sev === 'warning') return 'bg-gold-soft text-gold';
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
    header: 'Produit',
    render: (r) => <ProductCell productId={r.product_id} name={r.name} secondary={r.category_name ?? r.sku} />,
  },
  {
    id: 'issue',
    header: 'Problème',
    render: (r) => {
      const label = ISSUE_LABEL[r.issue_type];
      return (
        <div className="max-w-md">
          <span
            className={`inline-flex rounded-sm px-2 py-0.5 font-data text-[10px] font-semibold uppercase tracking-widest ${severityClass(r.severity)}`}
          >
            {label.title}
          </span>
          <p className="mt-1 text-[12px] text-text-muted">{label.hint}</p>
        </div>
      );
    },
  },
  {
    id: 'config',
    header: 'Config',
    render: (r) => (
      <span className="font-data text-[11.5px]">
        {flag('track', r.track_inventory)}
        <span className="text-text-inert"> · </span>
        {flag('deduct', r.deduct_stock)}
      </span>
    ),
  },
  {
    id: 'recipe_lines',
    header: 'Recette',
    align: 'right',
    render: (r) => <span className="font-data text-[12.5px]">{r.recipe_lines}</span>,
  },
  {
    id: 'stock',
    header: 'Stock',
    align: 'right',
    render: (r) => (
      <span className={`font-data text-[12.5px] ${Number(r.current_stock) < 0 ? 'font-semibold text-danger' : ''}`}>
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
      columns={COLUMNS}
      rows={rows}
      getRowKey={(r) => `${r.product_id}-${r.issue_type}`}
      isLoading={q.isLoading}
      density="compact"
      emptyTitle="Aucun produit mal configuré"
      emptyDescription="Suivi de stock, déduction et recettes concordent partout."
      data-testid="config-issues-table"
      footer={
        <span className="font-data text-[11px] text-text-muted tabular-nums">
          {rows.length} {rows.length === 1 ? 'produit' : 'produits'}
        </span>
      }
    />
  );
}
