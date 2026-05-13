// apps/backoffice/src/features/inventory-production/components/ProductionRecordList.tsx
//
// Recent production batches. Compact table — reverted rows are dimmed.
// Selecting a row exposes a "Revert" button (admin-only ; server enforces).

import { useState, type JSX } from 'react';
import { Button } from '@breakery/ui';
import { useProductionRecords } from '../hooks/useProductionRecords.js';
import { RevertProductionDialog } from './RevertProductionDialog.js';

export default function ProductionRecordList(): JSX.Element {
  const { data, isLoading, isError } = useProductionRecords();
  const [revertTarget, setRevertTarget] = useState<{ id: string; number: string } | null>(null);

  if (isLoading) return <div className="text-text-secondary text-sm">Loading…</div>;
  if (isError) return <div className="text-red text-sm">Error loading production records.</div>;
  const rows = data ?? [];
  if (rows.length === 0) {
    return <div className="text-text-muted text-sm">No production records yet.</div>;
  }

  return (
    <>
      <div className="border border-border-subtle rounded-lg overflow-hidden">
        <table className="w-full text-sm">
          <thead className="bg-bg-elevated text-xs uppercase tracking-widest text-text-secondary">
            <tr>
              <th className="px-3 py-2 text-left">Number</th>
              <th className="px-3 py-2 text-left">Product</th>
              <th className="px-3 py-2 text-right">Qty</th>
              <th className="px-3 py-2 text-right">Waste</th>
              <th className="px-3 py-2 text-left">Date</th>
              <th className="px-3 py-2 text-left">Status</th>
              <th className="px-3 py-2"></th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr
                key={r.id}
                className={`border-t border-border-subtle ${r.reverted_at !== null ? 'opacity-50' : ''}`}
              >
                <td className="px-3 py-2 font-mono">{r.production_number}</td>
                <td className="px-3 py-2">{r.product_name ?? r.product_id.slice(0, 8)}</td>
                <td className="px-3 py-2 text-right font-mono">{r.quantity_produced.toLocaleString()}</td>
                <td className="px-3 py-2 text-right font-mono">{r.quantity_waste.toLocaleString()}</td>
                <td className="px-3 py-2">{new Date(r.production_date).toLocaleString()}</td>
                <td className="px-3 py-2">
                  {r.reverted_at !== null
                    ? <span className="text-warning">Reverted</span>
                    : r.je_posted
                      ? <span className="text-success">Posted</span>
                      : <span className="text-text-muted">Pending</span>}
                </td>
                <td className="px-3 py-2 text-right">
                  {r.reverted_at === null && (
                    <Button
                      variant="ghost" size="sm"
                      onClick={() => setRevertTarget({ id: r.id, number: r.production_number })}
                    >
                      Revert
                    </Button>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {revertTarget !== null && (
        <RevertProductionDialog
          productionId={revertTarget.id}
          productionNumber={revertTarget.number}
          onClose={() => setRevertTarget(null)}
        />
      )}
    </>
  );
}
