// apps/backoffice/src/features/inventory-opname/components/CountItemRow.tsx
// Session 13 / Phase 2.D — one row in the OpnameDetail item table.

import { useState } from 'react';
import { Button } from '@breakery/ui';
import { useSetOpnameCount } from '../hooks/useOpnameMutations.js';
import type { OpnameItemRow } from '../hooks/useOpnameDetail.js';

export interface CountItemRowProps {
  countId:  string;
  item:     OpnameItemRow;
  readOnly: boolean;
}

export function CountItemRow({ countId, item, readOnly }: CountItemRowProps) {
  const [count, setCount] = useState<string>(
    item.counted_qty === null ? '' : String(item.counted_qty),
  );
  const [notes, setNotes] = useState<string>(item.notes ?? '');
  const [error, setError] = useState<string | null>(null);

  const setCountMutation = useSetOpnameCount();

  function handleSubmit() {
    const num = Number(count);
    if (!Number.isFinite(num) || num < 0) {
      setError('Enter a non-negative number.');
      return;
    }
    setError(null);
    setCountMutation.mutate(
      { countId, countItemId: item.id, countedQty: num, notes: notes.trim() === '' ? undefined : notes },
      {
        onError: (e) => { setError(e.message); },
      },
    );
  }

  const variance = item.counted_qty === null ? null : item.counted_qty - item.expected_qty;

  return (
    <tr className="border-b border-border-subtle">
      <td className="py-2 px-3 text-sm">
        <div className="font-medium text-text-primary">{item.product?.name ?? '—'}</div>
        <div className="text-xs text-text-secondary">{item.product?.sku ?? ''}</div>
      </td>
      <td className="py-2 px-3 text-sm font-mono text-right">
        {item.expected_qty} {item.unit}
      </td>
      <td className="py-2 px-3">
        {readOnly ? (
          <span className="font-mono text-sm">
            {item.counted_qty ?? '—'} {item.unit}
          </span>
        ) : (
          <input
            type="number"
            step="0.001"
            min={0}
            value={count}
            onChange={(e) => { setCount(e.target.value); }}
            onBlur={handleSubmit}
            className="w-24 px-2 py-1 text-right font-mono text-sm bg-bg-base border border-border-subtle rounded"
            aria-label={`Counted quantity for ${item.product?.name}`}
          />
        )}
      </td>
      <td className="py-2 px-3 text-sm font-mono text-right">
        {variance === null ? (
          <span className="text-text-secondary">—</span>
        ) : variance === 0 ? (
          <span className="text-emerald-600">0</span>
        ) : variance > 0 ? (
          <span className="text-emerald-600">+{variance}</span>
        ) : (
          <span className="text-rose-600">{variance}</span>
        )}
      </td>
      <td className="py-2 px-3 text-sm">
        {readOnly ? (
          <span className="text-text-secondary">{item.notes ?? ''}</span>
        ) : (
          <input
            type="text"
            value={notes}
            onChange={(e) => { setNotes(e.target.value); }}
            onBlur={handleSubmit}
            className="w-full px-2 py-1 text-sm bg-bg-base border border-border-subtle rounded"
            placeholder="Optional notes"
          />
        )}
      </td>
      {!readOnly && (
        <td className="py-2 px-2">
          <Button
            variant="ghost"
            size="sm"
            onClick={handleSubmit}
            disabled={setCountMutation.isPending}
          >
            {setCountMutation.isPending ? '…' : 'Save'}
          </Button>
          {error !== null && (
            <div className="text-xs text-rose-600 mt-1">{error}</div>
          )}
        </td>
      )}
    </tr>
  );
}
