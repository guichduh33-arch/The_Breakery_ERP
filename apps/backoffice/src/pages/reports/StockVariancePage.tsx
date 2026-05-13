// apps/backoffice/src/pages/reports/StockVariancePage.tsx
//
// Per-product variance table with color-coded variance column. Window
// defaults to the last 30 days. Section filter optional.

import { useState } from 'react';
import { cn } from '@breakery/ui';
import { ReportPage } from '@/features/reports/components/ReportPage.js';
import {
  useStockVariance,
  type StockVarianceRow,
} from '@/features/reports/hooks/useStockVariance.js';

function varianceTone(v: number): string {
  if (v === 0) return 'text-text-primary';
  if (v > 0)   return 'text-emerald-600';      // surplus (positive)
  if (v < -5)  return 'text-red-600 font-semibold';
  return 'text-amber-600';                     // small loss
}

export default function StockVariancePage() {
  const [days] = useState(30);
  const since  = new Date(Date.now() - days * 86_400_000).toISOString();
  const until  = new Date().toISOString();
  const { data, isLoading, error } = useStockVariance({
    dateStart: since,
    dateEnd:   until,
  });

  return (
    <ReportPage
      title="Stock Variance"
      subtitle={`Per-product variance over the last ${days} days. Positive = surplus, negative = shrinkage.`}
    >
      {isLoading && <p className="text-sm text-text-secondary">Loading…</p>}
      {error && (
        <p className="text-sm text-red-500" role="alert">
          {error.message ?? 'Failed to load report.'}
        </p>
      )}
      {data !== undefined && data !== null && (
        <table className="w-full text-sm">
          <thead>
            <tr className="text-text-secondary border-b border-border-subtle">
              <th className="py-2 text-left">Product</th>
              <th className="py-2 text-right">Opened</th>
              <th className="py-2 text-right">Sold</th>
              <th className="py-2 text-right">Adjusted</th>
              <th className="py-2 text-right">Current</th>
              <th className="py-2 text-right">Expected</th>
              <th className="py-2 text-right">Variance</th>
              <th className="py-2 text-right">%</th>
            </tr>
          </thead>
          <tbody>
            {data.length === 0 && (
              <tr>
                <td className="py-3 text-text-secondary" colSpan={8}>
                  No products to report.
                </td>
              </tr>
            )}
            {data.map((r: StockVarianceRow) => (
              <tr key={r.product_id} className="border-b border-border-subtle">
                <td className="py-2">
                  <div className="font-medium">{r.product_name}</div>
                  <div className="text-xs text-text-secondary">{r.sku}</div>
                </td>
                <td className="py-2 text-right tabular-nums">{r.opened}</td>
                <td className="py-2 text-right tabular-nums">{r.sold}</td>
                <td className="py-2 text-right tabular-nums">{r.adjusted}</td>
                <td className="py-2 text-right tabular-nums">{r.current_qty}</td>
                <td className="py-2 text-right tabular-nums">{r.expected}</td>
                <td className={cn('py-2 text-right tabular-nums', varianceTone(r.variance))}>
                  {r.variance > 0 ? `+${r.variance}` : r.variance}
                </td>
                <td className={cn('py-2 text-right tabular-nums', varianceTone(r.variance))}>
                  {r.variance_pct.toFixed(1)}%
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </ReportPage>
  );
}
