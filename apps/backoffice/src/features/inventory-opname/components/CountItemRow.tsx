// apps/backoffice/src/features/inventory-opname/components/CountItemRow.tsx
// Session 13 / Phase 2.D — one row in the OpnameDetail item table.
//
// Comptage à l'aveugle : la ligne rend deux visages selon la phase de
// l'inventaire, pilotés par deux drapeaux distincts.
//
//   `revealed` — l'attendu et l'écart sont-ils affichés ? Pendant le comptage,
//     NON : voir « attendu 12 » à côté de la case de saisie invite à écrire 12
//     au lieu du 9 qu'on a compté.
//   `locked`   — la saisie est-elle figée ? À partir de la revue, OUI : les
//     écarts sont révélés, on ne retouche plus un chiffre après l'avoir
//     comparé.
//
// Les deux drapeaux couvrent aujourd'hui le même ensemble de statuts, mais ils
// ne disent pas la même chose : les séparer évite qu'un futur statut hérite du
// mauvais comportement par accident.

import { useEffect, useId, useRef, useState } from 'react';
import { Button } from '@/components/BackofficeUi.js';
import { useSetOpnameCount } from '../hooks/useOpnameMutations.js';
import type { OpnameItemRow } from '../hooks/useOpnameDetail.js';
import { FOCUS_RING } from '@/components/focusRing.js';
import { formatStockQuantity, parseStockQuantity } from '@/features/inventory/stockQuantity.js';

export interface CountItemRowProps {
  countId:  string;
  item:     OpnameItemRow;
  /** Afficher l'attendu et l'écart (phase revue et au-delà). */
  revealed: boolean;
  /** Figer la saisie (phase revue et au-delà). */
  locked:   boolean;
  onEditingChange?: (itemId: string, blocked: boolean) => void;
}

export function CountItemRow({ countId, item, revealed, locked, onEditingChange }: CountItemRowProps) {
  const [count, setCount] = useState<string>(
    item.counted_qty === null ? '' : String(item.counted_qty),
  );
  const [notes, setNotes] = useState<string>(item.notes ?? '');
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState({ count: item.counted_qty === null ? '' : String(item.counted_qty), notes: item.notes ?? '' });
  const errorId = useId();
  const dirty = count !== saved.count || notes !== saved.notes;

  const setCountMutation = useSetOpnameCount();
  const saving = useRef(false);
  useEffect(() => {
    onEditingChange?.(item.id, !locked && (dirty || error !== null || setCountMutation.isPending));
  }, [dirty, error, item.id, locked, onEditingChange, setCountMutation.isPending]);
  useEffect(() => () => { onEditingChange?.(item.id, false); }, [item.id, onEditingChange]);

  function handleSubmit() {
    if (locked || setCountMutation.isPending || saving.current) return;
    const num = parseStockQuantity(count);
    if (num === null) {
      setError('Enter a non-negative quantity with up to 3 decimal places.');
      return;
    }
    if (!dirty && error === null) return;
    setError(null);
    saving.current = true;
    setCountMutation.mutate(
      { countId, countItemId: item.id, countedQty: num, notes: notes.trim() },
      {
        onSuccess: () => { setSaved({ count, notes }); },
        onError: (e) => { setError(e.message); },
        onSettled: () => { saving.current = false; },
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
      {revealed && (
        <td className="py-2 px-3 text-sm font-mono text-right" data-testid="cell-expected">
          {formatStockQuantity(item.expected_qty, item.unit)}
        </td>
      )}
      <td className="py-2 px-3">
        {locked ? (
          <span className="font-mono text-sm">
            {item.counted_qty === null ? '—' : formatStockQuantity(item.counted_qty, item.unit)}
          </span>
        ) : (
          <div className="flex items-center gap-2">
          <input
            type="number"
            inputMode="decimal"
            step="0.001"
            min={0}
            value={count}
            onChange={(e) => { setCount(e.target.value); }}
            onBlur={handleSubmit}
            className={`w-24 px-2 py-1 text-right font-mono text-sm bg-bg-base border border-border-strong rounded ${FOCUS_RING}`}
            aria-label={`Counted quantity for ${item.product?.name}`}
            aria-invalid={error !== null}
            aria-describedby={error !== null ? errorId : undefined}
            disabled={setCountMutation.isPending}
          />
          <span className="text-xs text-text-secondary">{item.unit}</span>
          </div>
        )}
      </td>
      {revealed && (
        <td className="py-2 px-3 text-sm font-mono text-right" data-testid="cell-variance">
          {variance === null ? (
            <span className="text-text-secondary">—</span>
          ) : variance === 0 ? (
            <span className="text-success">0</span>
          ) : variance > 0 ? (
            <span className="text-success">+{formatStockQuantity(variance, item.unit)}</span>
          ) : (
            <span className="text-danger">{formatStockQuantity(variance, item.unit)}</span>
          )}
        </td>
      )}
      <td className="py-2 px-3 text-sm">
        {locked ? (
          <span className="text-text-secondary">{item.notes ?? ''}</span>
        ) : (
          <input
            type="text"
            value={notes}
            onChange={(e) => { setNotes(e.target.value); }}
            onBlur={handleSubmit}
            className={`w-full px-2 py-1 text-sm bg-bg-base border border-border-strong rounded placeholder:text-text-muted ${FOCUS_RING}`}
            placeholder="Optional notes"
            aria-label={`Notes for ${item.product?.name}`}
            disabled={setCountMutation.isPending}
          />
        )}
      </td>
      {!locked && (
        <td className="py-2 px-2">
          <Button
            variant="ghost"
            size="sm"
            onClick={handleSubmit}
            disabled={setCountMutation.isPending}
          >
            {setCountMutation.isPending ? '…' : 'Save'}
          </Button>
          <span role="status" className="block text-xs text-text-secondary">
            {setCountMutation.isPending ? 'Saving…' : error !== null ? 'Not saved' : dirty ? 'Unsaved changes' : item.counted_qty !== null || saved.count !== '' ? 'Saved' : ''}
          </span>
          {error !== null && (
            <div id={errorId} role="alert" className="text-xs text-danger mt-1">{error}</div>
          )}
        </td>
      )}
    </tr>
  );
}
