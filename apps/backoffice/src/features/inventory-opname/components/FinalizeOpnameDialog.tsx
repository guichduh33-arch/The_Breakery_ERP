// apps/backoffice/src/features/inventory-opname/components/FinalizeOpnameDialog.tsx
// Session 13 / Phase 2.D — confirm + finalize a count (emits movements + JE).

import { useState } from 'react';
import { Button } from '@breakery/ui';
import { useFinalizeOpname } from '../hooks/useOpnameMutations.js';
import type { OpnameItemRow } from '../hooks/useOpnameDetail.js';

export interface FinalizeOpnameDialogProps {
  countId:  string;
  items:    OpnameItemRow[];
  onClose:  () => void;
}

export function FinalizeOpnameDialog({ countId, items, onClose }: FinalizeOpnameDialogProps) {
  const finalize = useFinalizeOpname();
  const [error, setError] = useState<string | null>(null);

  const withVariance = items.filter((i) => i.variance !== null && i.variance !== 0);
  const totalVarianceAbs = withVariance.reduce(
    (s, i) => s + Math.abs(i.variance ?? 0), 0,
  );

  function handleSubmit() {
    setError(null);
    finalize.mutate(
      { countId },
      {
        onSuccess: () => { onClose(); },
        onError:   (e) => { setError(e.message); },
      },
    );
  }

  return (
    <div className="fixed inset-0 bg-black/40 z-50 flex items-center justify-center" role="dialog" aria-modal="true">
      <div className="bg-bg-elevated rounded-md border border-border-subtle w-full max-w-lg p-5 shadow-lg">
        <h3 className="text-lg font-serif mb-3">Finalize stock count</h3>
        <p className="text-sm text-text-secondary mb-3">
          This emits <strong>{withVariance.length}</strong> stock-movement row(s) totalling{' '}
          <strong className="font-mono">{totalVarianceAbs}</strong> unit(s) of variance.
          The accounting trigger will post a balanced journal entry per movement.
        </p>
        <p className="text-sm text-text-secondary mb-3">
          This action is <strong>not reversible</strong>. Cancel from this screen
          before clicking finalize if you need more changes.
        </p>

        {error !== null && (
          <div className="text-sm text-rose-600 mb-3">{error}</div>
        )}

        <div className="flex justify-end gap-2">
          <Button variant="ghost" onClick={onClose}>Cancel</Button>
          <Button onClick={handleSubmit} disabled={finalize.isPending}>
            {finalize.isPending ? 'Finalizing…' : 'Finalize & post JE'}
          </Button>
        </div>
      </div>
    </div>
  );
}
