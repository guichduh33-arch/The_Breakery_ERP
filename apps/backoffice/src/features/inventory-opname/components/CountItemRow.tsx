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

import { useState } from 'react';
import { Button } from '@breakery/ui';
import { useSetOpnameCount } from '../hooks/useOpnameMutations.js';
import type { OpnameItemRow } from '../hooks/useOpnameDetail.js';
import { FOCUS_RING } from '@/components/focusRing.js';

export interface CountItemRowProps {
  countId:  string;
  item:     OpnameItemRow;
  /** Afficher l'attendu et l'écart (phase revue et au-delà). */
  revealed: boolean;
  /** Figer la saisie (phase revue et au-delà). */
  locked:   boolean;
}

export function CountItemRow({ countId, item, revealed, locked }: CountItemRowProps) {
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
      {revealed && (
        <td className="py-2 px-3 text-sm font-mono text-right" data-testid="cell-expected">
          {item.expected_qty} {item.unit}
        </td>
      )}
      <td className="py-2 px-3">
        {locked ? (
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
            className={`w-24 px-2 py-1 text-right font-mono text-sm bg-bg-base border border-border-subtle rounded ${FOCUS_RING}`}
            aria-label={`Counted quantity for ${item.product?.name}`}
          />
        )}
      </td>
      {revealed && (
        <td className="py-2 px-3 text-sm font-mono text-right" data-testid="cell-variance">
          {variance === null ? (
            <span className="text-text-secondary">—</span>
          ) : variance === 0 ? (
            <span className="text-success">0</span>
          ) : variance > 0 ? (
            <span className="text-success">+{variance}</span>
          ) : (
            <span className="text-danger">{variance}</span>
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
            className={`w-full px-2 py-1 text-sm bg-bg-base border border-border-subtle rounded placeholder:text-text-muted ${FOCUS_RING}`}
            placeholder="Optional notes"
            aria-label={`Notes for ${item.product?.name}`}
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
          {error !== null && (
            <div className="text-xs text-danger mt-1">{error}</div>
          )}
        </td>
      )}
    </tr>
  );
}
