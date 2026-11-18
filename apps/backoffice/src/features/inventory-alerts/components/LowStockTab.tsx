// apps/backoffice/src/features/inventory-alerts/components/LowStockTab.tsx
// Session 13 / Phase 2.D — Low Stock tab content of AlertsPage.
//
// Refonte design 2026-08-08 — passe au DataTable partagé (en-tête sur
// remplissage inerte, libellés mono, état vide et squelettes corrects). Le
// contenu et la source de données sont inchangés.
//
// S3-10 — la RPC ignore les produits sans seuil (`min_stock_threshold ≤ 0`).
// Un bandeau dit combien de produits suivis échappent ainsi à l'alerte, et
// l'état vide cesse d'affirmer « tout est au-dessus du seuil » tant qu'il en
// reste. Aucune promesse de notification.

import type { JSX } from 'react';
import { type DataTableColumn } from '@breakery/ui';
import { DataTable } from '@/components/BackofficeUi.js';
import { formatQuantity } from '@breakery/utils';
import { useLowStock, type LowStockRow } from '../hooks/useLowStock.js';
import { useProductsWithoutThreshold } from '../hooks/useProductsWithoutThreshold.js';
import { ProductCell } from './ProductCell.js';

// Une quantité de stock se lit en mono tabulaire, unité comprise. Le rendu
// passe par `formatQuantity` (audit UX/UI 2026-08-13) : un seuil de 1 000 000
// s'écrivait sans aucun séparateur, et un manque de 5 pièces se lisait
// « 5.000 » — soit cinq mille pour un œil habitué au point indonésien.
// `formatQuantity` porte l'unité elle-même, d'où la disparition du second
// span : la répéter en afficherait deux.
function qty(value: number, unit: string): JSX.Element {
  return <span className="font-data text-xs tabular-nums">{formatQuantity(value, unit)}</span>;
}

const COLUMNS: DataTableColumn<LowStockRow>[] = [
  {
    id: 'product',
    header: 'Product',
    render: (r) => <ProductCell productId={r.product_id} name={r.product_name} secondary={r.product_sku} />,
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
      <span className="font-data text-xs font-semibold tabular-nums">
        {formatQuantity(r.shortfall, r.unit)}
      </span>
    ),
  },
];

function NoThresholdBanner({ count }: { count: number }): JSX.Element {
  const subject = count === 1 ? 'tracked product has' : 'tracked products have';
  const pronoun = count === 1 ? 'it' : 'they';
  return (
    <div
      role="status"
      data-testid="low-stock-no-threshold"
      className="rounded border border-warning bg-warning-soft px-3 py-2 text-sm text-warning"
    >
      <span className="font-semibold tabular-nums">{count}</span> {subject} no low-stock
      threshold, so {pronoun} can never appear in this list. Set a minimum stock level on
      the product to include {count === 1 ? 'it' : 'them'}.
    </div>
  );
}

export function LowStockTab(): JSX.Element {
  const q = useLowStock();
  const noThreshold = useProductsWithoutThreshold();
  const missing = noThreshold.data;

  if (q.error !== null) {
    return <p className="text-sm text-danger" role="alert">Failed to load low stock: {q.error.message}</p>;
  }

  const rows = q.data ?? [];

  // « Tout va bien » ne se dit que si l'on SAIT qu'aucun produit suivi
  // n'échappe au contrôle : compteur chargé et nul.
  const allChecked = missing === 0;

  return (
    <div className="space-y-3">
      {missing !== undefined && missing > 0 && <NoThresholdBanner count={missing} />}
      <DataTable<LowStockRow>
        caption="Product, quantity on hand, minimum level and shortfall per low-stock product"
        columns={COLUMNS}
        rows={rows}
        getRowKey={(r) => r.product_id}
        isLoading={q.isLoading}
        density="compact"
        emptyTitle={allChecked ? 'All above threshold' : 'Nothing below a set minimum'}
        emptyDescription={
          allChecked
            ? 'Every tracked product sits at or above its minimum.'
            : 'Only products with a minimum stock level are checked here.'
        }
        data-testid="low-stock-table"
        footer={
          <span className="font-data text-xs text-text-muted tabular-nums">
            {rows.length} {rows.length === 1 ? 'product' : 'products'}
          </span>
        }
      />
    </div>
  );
}
