// apps/backoffice/src/features/inventory-alerts/components/ConfigIssuesTab.tsx
// Audit 2026-07-08 — onglet "Config produit" de AlertsPage.
// Liste les produits dont track_inventory/deduct_stock + recette ne déduisent
// pas le stock attendu à la vente.

import { Link } from 'react-router-dom';
import {
  useStockConfigIssues,
  type StockConfigIssueRow,
  type StockConfigIssueType,
} from '../hooks/useStockConfigIssues.js';

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
  if (sev === 'critical') return 'bg-danger/15 text-danger';
  if (sev === 'warning') return 'bg-gold/15 text-gold';
  return 'bg-bg-subtle text-text-secondary';
}

export function ConfigIssuesTab() {
  const q = useStockConfigIssues();

  if (q.isLoading) return <div className="text-sm text-text-secondary">Loading…</div>;
  if (q.error !== null) return <div className="text-sm text-danger">Failed: {String(q.error)}</div>;

  const rows = q.data ?? [];
  if (rows.length === 0) {
    return <div className="text-sm text-text-secondary">Aucun produit mal configuré. Nice.</div>;
  }

  return (
    <table className="w-full text-sm">
      <thead className="text-xs uppercase text-text-secondary border-b border-border-subtle">
        <tr>
          <th className="text-left py-2 px-3">Produit</th>
          <th className="text-left py-2 px-3">Problème</th>
          <th className="text-left py-2 px-3">Config</th>
          <th className="text-right py-2 px-3">Recette</th>
          <th className="text-right py-2 px-3">Stock</th>
        </tr>
      </thead>
      <tbody>
        {rows.map((r) => {
          const label = ISSUE_LABEL[r.issue_type];
          return (
            <tr key={`${r.product_id}-${r.issue_type}`} className="border-b border-border-subtle align-top">
              <td className="py-2 px-3">
                <Link
                  to={`/backoffice/products/${r.product_id}/dashboard`}
                  className="text-gold hover:underline"
                >
                  {r.name}
                </Link>
                <div className="text-xs text-text-secondary">{r.category_name ?? r.sku}</div>
              </td>
              <td className="py-2 px-3">
                <span className={`inline-block rounded px-2 py-0.5 text-xs font-medium ${severityClass(r.severity)}`}>
                  {label.title}
                </span>
                <div className="text-xs text-text-secondary mt-1 max-w-md">{label.hint}</div>
              </td>
              <td className="py-2 px-3 font-mono text-xs">
                <span className={r.track_inventory ? 'text-text-primary' : 'text-text-secondary line-through'}>track</span>
                {' · '}
                <span className={r.deduct_stock ? 'text-text-primary' : 'text-text-secondary line-through'}>deduct</span>
              </td>
              <td className="py-2 px-3 text-right font-mono">{r.recipe_lines}</td>
              <td className={`py-2 px-3 text-right font-mono ${Number(r.current_stock) < 0 ? 'text-danger font-medium' : ''}`}>
                {Number(r.current_stock)}
              </td>
            </tr>
          );
        })}
      </tbody>
    </table>
  );
}
