// apps/backoffice/src/features/inventory-alerts/components/LowStockTab.tsx
// Session 13 / Phase 2.D — Low Stock tab content of AlertsPage.

import { Link } from 'react-router-dom';
import { useLowStock } from '../hooks/useLowStock.js';

export function LowStockTab() {
  const q = useLowStock(null);

  if (q.isLoading) return <div className="text-sm text-text-secondary">Loading…</div>;
  if (q.error !== null) return <div className="text-sm text-danger">Failed: {String(q.error)}</div>;

  const rows = q.data ?? [];
  if (rows.length === 0) {
    return <div className="text-sm text-text-secondary">No low-stock products. Nice.</div>;
  }

  return (
    <table className="w-full text-sm">
      <thead className="text-xs uppercase text-text-secondary border-b border-border-subtle">
        <tr>
          <th className="text-left py-2 px-3">Product</th>
          <th className="text-right py-2 px-3">Current</th>
          <th className="text-right py-2 px-3">Threshold</th>
          <th className="text-right py-2 px-3">Shortfall</th>
        </tr>
      </thead>
      <tbody>
        {rows.map((r) => (
          <tr key={r.product_id} className="border-b border-border-subtle">
            <td className="py-2 px-3">
              <Link
                to={`/backoffice/products/${r.product_id}/dashboard`}
                className="text-gold hover:underline"
              >
                {r.product_name}
              </Link>
              <div className="text-xs text-text-secondary">{r.product_sku}</div>
            </td>
            <td className="py-2 px-3 text-right font-mono text-danger">
              {Number(r.current_qty)} {r.unit}
            </td>
            <td className="py-2 px-3 text-right font-mono">
              {Number(r.min_stock_threshold)} {r.unit}
            </td>
            <td className="py-2 px-3 text-right font-mono font-medium">
              {Number(r.shortfall).toFixed(3)} {r.unit}
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}
