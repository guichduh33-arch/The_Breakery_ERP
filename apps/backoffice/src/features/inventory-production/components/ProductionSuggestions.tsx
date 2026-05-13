// apps/backoffice/src/features/inventory-production/components/ProductionSuggestions.tsx
//
// Inline list of suggested productions (high/medium priority first).

import type { JSX } from 'react';
import { useProductionSuggestions } from '../hooks/useProductionSuggestions.js';

const PRIORITY_STYLE: Record<'high' | 'medium' | 'low', string> = {
  high:   'border-red bg-red/5 text-red',
  medium: 'border-warning bg-warning/5 text-warning',
  low:    'border-border-subtle bg-bg-overlay text-text-secondary',
};

export default function ProductionSuggestions(): JSX.Element {
  const { data, isLoading } = useProductionSuggestions();
  if (isLoading) return <div className="text-text-secondary text-sm">Loading suggestions…</div>;
  const rows = data ?? [];
  if (rows.length === 0) {
    return <div className="text-text-muted text-sm">No production suggestions — all finished products are well stocked.</div>;
  }
  return (
    <ul className="space-y-2">
      {rows.map((s) => (
        <li key={s.product_id} className={`border rounded-md p-3 text-sm flex items-center justify-between ${PRIORITY_STYLE[s.priority]}`}>
          <div>
            <div className="font-semibold">{s.product_name}</div>
            <div className="text-xs">
              avg {s.avg_daily_sales.toFixed(1)}/day · stock {s.current_stock} ·
              {s.days_of_stock !== null ? ` ${s.days_of_stock.toFixed(1)}d left` : ' n/a'}
            </div>
          </div>
          <div className="font-mono text-gold">
            Produce {s.suggested_quantity.toLocaleString()}
          </div>
        </li>
      ))}
    </ul>
  );
}
