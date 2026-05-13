// apps/backoffice/src/features/inventory-opname/components/FinalizeOpnameDialog.tsx
// Session 13 / Phase 2.D — confirm + finalize a count (emits movements + JE).
// Phase 4.D — migrated from ad-hoc <div> overlay to @breakery/ui Radix Dialog.

import { useState, type JSX } from 'react';
import {
  Button,
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from '@breakery/ui';
import { useFinalizeOpname } from '../hooks/useOpnameMutations.js';
import type { OpnameItemRow } from '../hooks/useOpnameDetail.js';

export interface FinalizeOpnameDialogProps {
  countId:  string;
  items:    OpnameItemRow[];
  onClose:  () => void;
}

export function FinalizeOpnameDialog({ countId, items, onClose }: FinalizeOpnameDialogProps): JSX.Element {
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
    <Dialog open onOpenChange={(o) => { if (!o) onClose(); }}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>Finalize stock count</DialogTitle>
          <DialogDescription className="sr-only">
            Confirm finalization of this stock count, emitting movements and journal entries.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-3 text-sm text-text-secondary">
          <p>
            This emits <strong>{withVariance.length}</strong> stock-movement row(s) totalling{' '}
            <strong className="font-mono">{totalVarianceAbs}</strong> unit(s) of variance.
            The accounting trigger will post a balanced journal entry per movement.
          </p>
          <p>
            This action is <strong>not reversible</strong>. Cancel from this screen
            before clicking finalize if you need more changes.
          </p>

          {error !== null && (
            <div role="alert" className="text-red">{error}</div>
          )}
        </div>

        <DialogFooter>
          <Button variant="ghost" onClick={onClose}>Cancel</Button>
          <Button onClick={handleSubmit} disabled={finalize.isPending}>
            {finalize.isPending ? 'Finalizing…' : 'Finalize & post JE'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
