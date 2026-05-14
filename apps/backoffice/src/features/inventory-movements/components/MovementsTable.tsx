// apps/backoffice/src/features/inventory-movements/components/MovementsTable.tsx
// Session 13 / Phase 2.D — feed table with infinite-scroll "Load more" button.

import type { MovementRow } from '../hooks/useStockMovementsFeed.js';
import { Button } from '@breakery/ui';

export interface MovementsTableProps {
  rows:          MovementRow[];
  hasNext:       boolean;
  isFetchingNext: boolean;
  onLoadMore:    () => void;
}

export function MovementsTable({ rows, hasNext, isFetchingNext, onLoadMore }: MovementsTableProps) {
  if (rows.length === 0) {
    return <div className="text-sm text-text-secondary py-4">No movements match the filters.</div>;
  }

  return (
    <div>
      <table className="w-full text-sm">
        <thead className="text-xs uppercase text-text-secondary border-b border-border-subtle sticky top-0 bg-bg-elevated">
          <tr>
            <th className="text-left py-2 px-3">When</th>
            <th className="text-left py-2 px-3">Type</th>
            <th className="text-left py-2 px-3">Product</th>
            <th className="text-right py-2 px-3">Qty</th>
            <th className="text-left py-2 px-3">From → To</th>
            <th className="text-left py-2 px-3">Reason</th>
            <th className="text-left py-2 px-3">By</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.id} className="border-b border-border-subtle hover:bg-bg-overlay">
              <td className="py-2 px-3 text-xs text-text-secondary font-mono whitespace-nowrap">
                {new Date(r.created_at).toLocaleString()}
              </td>
              <td className="py-2 px-3 text-xs font-mono">{r.movement_type}</td>
              <td className="py-2 px-3">
                <div className="font-medium">{r.product_name ?? '—'}</div>
                <div className="text-xs text-text-secondary">{r.product_sku ?? ''}</div>
              </td>
              <td className={`py-2 px-3 text-right font-mono ${r.quantity > 0 ? 'text-emerald-600' : 'text-rose-600'}`}>
                {r.quantity > 0 ? '+' : ''}{r.quantity} {r.unit}
              </td>
              <td className="py-2 px-3 text-xs text-text-secondary">
                {r.from_section_code ?? '—'} → {r.to_section_code ?? '—'}
              </td>
              <td className="py-2 px-3 text-xs text-text-secondary truncate max-w-xs">
                {r.reason ?? ''}
              </td>
              <td className="py-2 px-3 text-xs text-text-secondary">
                {r.author_name ?? ''}
              </td>
            </tr>
          ))}
        </tbody>
      </table>

      {hasNext && (
        <div className="text-center py-3">
          <Button variant="ghost" onClick={onLoadMore} disabled={isFetchingNext}>
            {isFetchingNext ? 'Loading…' : 'Load more'}
          </Button>
        </div>
      )}
    </div>
  );
}
