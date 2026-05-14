// apps/backoffice/src/features/inventory-dashboard/components/StockBySectionList.tsx
// Session 13 / Phase 2.D — per-section stock breakdown card.

import type { ProductDashboardData } from '../hooks/useProductDashboard.js';

export function StockBySectionList({ rows }: { rows: ProductDashboardData['stock_by_section'] }) {
  const total = rows.reduce((s, r) => s + Number(r.quantity), 0);
  const totalValue = rows.reduce((s, r) => s + Number(r.value_at_cost), 0);

  if (rows.length === 0) {
    return (
      <div className="border border-border-subtle rounded-md p-4 bg-bg-elevated">
        <div className="text-xs uppercase tracking-wider text-text-secondary mb-2">Stock by section</div>
        <div className="text-sm text-text-secondary">No section_stock entries yet.</div>
      </div>
    );
  }

  return (
    <div className="border border-border-subtle rounded-md bg-bg-elevated">
      <div className="text-xs uppercase tracking-wider text-text-secondary px-4 py-2 border-b border-border-subtle">
        Stock by section
      </div>
      <table className="w-full text-sm">
        <thead className="text-xs uppercase text-text-secondary">
          <tr>
            <th className="text-left py-2 px-3">Section</th>
            <th className="text-right py-2 px-3">Quantity</th>
            <th className="text-right py-2 px-3">Value @ cost</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.section_id} className="border-t border-border-subtle">
              <td className="py-2 px-3">{r.section_name}</td>
              <td className="py-2 px-3 text-right font-mono">{Number(r.quantity)} {r.unit}</td>
              <td className="py-2 px-3 text-right font-mono">{Number(r.value_at_cost).toFixed(0)}</td>
            </tr>
          ))}
        </tbody>
        <tfoot className="bg-bg-overlay">
          <tr>
            <td className="py-2 px-3 font-medium">Total</td>
            <td className="py-2 px-3 text-right font-mono font-medium">{total.toFixed(3)}</td>
            <td className="py-2 px-3 text-right font-mono font-medium">{totalValue.toFixed(0)}</td>
          </tr>
        </tfoot>
      </table>
    </div>
  );
}
