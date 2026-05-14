// apps/backoffice/src/features/inventory-opname/components/CancelOpnameDialog.tsx
// Session 13 / Phase 2.D — cancel a non-finalized opname with a mandatory reason.
// Phase 4.D — migrated from ad-hoc <div> overlay to @breakery/ui Radix Dialog.

import { useState, type JSX } from 'react';
import {
  Button,
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from '@breakery/ui';
import { useCancelOpname } from '../hooks/useOpnameMutations.js';

export interface CancelOpnameDialogProps {
  countId: string;
  onClose: () => void;
}

export function CancelOpnameDialog({ countId, onClose }: CancelOpnameDialogProps): JSX.Element {
  const [reason, setReason] = useState<string>('');
  const [error, setError] = useState<string | null>(null);
  const cancelMutation = useCancelOpname();

  function handleSubmit() {
    if (reason.trim().length < 3) {
      setError('Reason must be at least 3 characters.');
      return;
    }
    setError(null);
    cancelMutation.mutate(
      { countId, reason: reason.trim() },
      {
        onSuccess: onClose,
        onError:   (e) => { setError(e.message); },
      },
    );
  }

  return (
    <Dialog open onOpenChange={(o) => { if (!o) onClose(); }}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>Cancel stock count</DialogTitle>
          <DialogDescription>
            The count and all of its items will be marked cancelled. No stock movements are emitted.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-2">
          <label htmlFor="opname-cancel-reason" className="block text-xs uppercase tracking-wider text-text-secondary">
            Reason
          </label>
          <textarea
            id="opname-cancel-reason"
            value={reason}
            onChange={(e) => { setReason(e.target.value); }}
            rows={3}
            className="w-full px-2 py-2 text-sm bg-bg-base border border-border-subtle rounded"
            placeholder="Why is this count being cancelled? (>=3 chars)"
          />

          {error !== null && (
            <div role="alert" className="text-sm text-red">{error}</div>
          )}
        </div>

        <DialogFooter>
          <Button variant="ghost" onClick={onClose}>Keep</Button>
          <Button variant="ghostDestructive" onClick={handleSubmit} disabled={cancelMutation.isPending}>
            {cancelMutation.isPending ? 'Cancelling…' : 'Cancel count'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
