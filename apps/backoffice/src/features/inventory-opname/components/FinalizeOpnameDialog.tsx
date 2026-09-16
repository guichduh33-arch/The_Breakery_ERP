// apps/backoffice/src/features/inventory-opname/components/FinalizeOpnameDialog.tsx
// Session 13 / Phase 2.D — confirm + finalize a count (emits movements + JE).
// Phase 4.D — migrated from ad-hoc <div> overlay to @breakery/ui Radix Dialog.

import { useState, type JSX } from 'react';
import { Dialog, DialogDescription } from '@breakery/ui';
import { Button, DialogContent, DialogFooter, DialogHeader, DialogTitle } from '@/components/BackofficeUi.js';
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

  function handleSubmit() {
    if (finalize.isPending) return;
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
    <Dialog open onOpenChange={(o) => { if (!o && !finalize.isPending) onClose(); }}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>Finalize stock count</DialogTitle>
          <DialogDescription className="sr-only">
            Confirm finalization of this stock count, emitting movements and journal entries.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-3 text-sm text-text-secondary">
          <p>
            <strong>{withVariance.length}</strong> product(s) have a variance.
            Finalizing records the stock corrections and their applicable accounting entries.
          </p>
          <p>
            This action is <strong>not reversible</strong>. To correct a counting
            mistake, close this dialog, cancel the count and start a new count.
          </p>

          {error !== null && (
            <div role="alert" className="text-red">{error}</div>
          )}
        </div>

        <DialogFooter>
          <Button variant="ghost" onClick={onClose} disabled={finalize.isPending}>Back to review</Button>
          <Button variant="ink" onClick={handleSubmit} disabled={finalize.isPending}>
            {finalize.isPending ? 'Finalizing…' : 'Finalize & post JE'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
