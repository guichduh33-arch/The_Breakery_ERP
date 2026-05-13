// apps/backoffice/src/features/inventory-opname/components/CancelOpnameDialog.tsx
// Session 13 / Phase 2.D — cancel a non-finalized opname with a mandatory reason.

import { useState } from 'react';
import { Button } from '@breakery/ui';
import { useCancelOpname } from '../hooks/useOpnameMutations.js';

export interface CancelOpnameDialogProps {
  countId: string;
  onClose: () => void;
}

export function CancelOpnameDialog({ countId, onClose }: CancelOpnameDialogProps) {
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
    <div className="fixed inset-0 bg-black/40 z-50 flex items-center justify-center" role="dialog" aria-modal="true">
      <div className="bg-bg-elevated rounded-md border border-border-subtle w-full max-w-md p-5 shadow-lg">
        <h3 className="text-lg font-serif mb-3">Cancel stock count</h3>
        <p className="text-sm text-text-secondary mb-3">
          The count and all of its items will be marked <strong>cancelled</strong>.
          No stock movements are emitted.
        </p>

        <label htmlFor="opname-cancel-reason" className="block text-xs uppercase tracking-wider text-text-secondary mb-1">
          Reason
        </label>
        <textarea
          id="opname-cancel-reason"
          value={reason}
          onChange={(e) => { setReason(e.target.value); }}
          rows={3}
          className="w-full px-2 py-2 mb-3 text-sm bg-bg-base border border-border-subtle rounded"
          placeholder="Why is this count being cancelled? (>=3 chars)"
        />

        {error !== null && (
          <div className="text-sm text-rose-600 mb-3">{error}</div>
        )}

        <div className="flex justify-end gap-2">
          <Button variant="ghost" onClick={onClose}>Keep</Button>
          <Button onClick={handleSubmit} disabled={cancelMutation.isPending}>
            {cancelMutation.isPending ? 'Cancelling…' : 'Cancel count'}
          </Button>
        </div>
      </div>
    </div>
  );
}
