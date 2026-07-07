// apps/backoffice/src/features/inventory-alerts/components/ReorderTab.tsx
// Session 13 / Phase 2.D — Reorder Suggestions tab.

import { useState } from 'react';
import { Link } from 'react-router-dom';
import { useReorderSuggestions } from '../hooks/useReorderSuggestions.js';

export function ReorderTab() {
  const [lookback, setLookback] = useState<number>(30);
  const [buffer, setBuffer] = useState<number>(14);
  const q = useReorderSuggestions(lookback, buffer);

  return (
    <div className="space-y-3">
      <div className="flex items-end gap-3 text-sm">
        <div>
          <label htmlFor="reorder-lookback" className="block text-xs text-text-secondary mb-1">Lookback (days)</label>
          <input
            id="reorder-lookback"
            type="number"
            min={1}
            value={lookback}
            onChange={(e) => { setLookback(Math.max(1, Number(e.target.value) || 30)); }}
            className="w-24 px-2 py-1 bg-bg-base border border-border-subtle rounded"
          />
        </div>
        <div>
          <label htmlFor="reorder-buffer" className="block text-xs text-text-secondary mb-1">Buffer (days)</label>
          <input
            id="reorder-buffer"
            type="number"
            min={1}
            value={buffer}
            onChange={(e) => { setBuffer(Math.max(1, Number(e.target.value) || 14)); }}
            className="w-24 px-2 py-1 bg-bg-base border border-border-subtle rounded"
          />
        </div>
        <div className="text-xs text-text-secondary self-center">
          suggested_order_qty = MAX(0, avg_daily_usage × buffer − current_stock)
        </div>
      </div>

      {q.isLoading ? (
        <div className="text-sm text-text-secondary">Loading…</div>
      ) : q.error !== null ? (
        <div className="text-sm text-danger">Failed: {String(q.error)}</div>
      ) : (q.data ?? []).length === 0 ? (
        <div className="text-sm text-text-secondary">No reorder suggestions in this window.</div>
      ) : (
        <table className="w-full text-sm">
          <thead className="text-xs uppercase text-text-secondary border-b border-border-subtle">
            <tr>
              <th className="text-left py-2 px-3">Product</th>
              <th className="text-right py-2 px-3">Stock</th>
              <th className="text-right py-2 px-3">Avg daily</th>
              <th className="text-right py-2 px-3">Days left</th>
              <th className="text-right py-2 px-3">Suggested order</th>
              <th className="text-left py-2 px-3">Last supplier</th>
            </tr>
          </thead>
          <tbody>
            {(q.data ?? []).map((r) => (
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
                <td className="py-2 px-3 text-right font-mono">{Number(r.current_stock)} {r.unit}</td>
                <td className="py-2 px-3 text-right font-mono">{Number(r.avg_daily_usage).toFixed(2)}</td>
                <td className={`py-2 px-3 text-right font-mono ${(r.days_of_stock ?? 999) < 3 ? 'text-danger font-bold' : 'text-text-secondary'}`}>
                  {r.days_of_stock === null ? '—' : Number(r.days_of_stock).toFixed(1)}
                </td>
                <td className="py-2 px-3 text-right font-mono font-medium">
                  {Number(r.suggested_order_qty).toFixed(2)} {r.unit}
                </td>
                <td className="py-2 px-3 text-xs text-text-secondary">
                  {r.supplier_name ?? '—'}
                  {r.last_purchase_at !== null && (
                    <div className="text-[11px]">{new Date(r.last_purchase_at).toLocaleDateString()}</div>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}
