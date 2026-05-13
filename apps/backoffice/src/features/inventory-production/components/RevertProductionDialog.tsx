// apps/backoffice/src/features/inventory-production/components/RevertProductionDialog.tsx
//
// Minimal modal asking for a reason then calling revert_production_v1.
// ADMIN+ only — server enforces ; this UI shows the button regardless and
// surfaces the `forbidden` error inline.
//
// Phase 4.D — migrated from ad-hoc <div> overlay to @breakery/ui Radix Dialog.

import { useState, type FormEvent, type JSX } from 'react';
import {
  Button, Input,
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from '@breakery/ui';
import { useRevertProduction, RevertProductionError } from '../hooks/useRevertProduction.js';

export interface RevertProductionDialogProps {
  productionId:     string;
  productionNumber: string;
  onClose:          () => void;
}

export function RevertProductionDialog({
  productionId, productionNumber, onClose,
}: RevertProductionDialogProps): JSX.Element {
  const [reason, setReason] = useState('');
  const [error, setError] = useState<string | null>(null);
  const mut = useRevertProduction();

  async function handleSubmit(e: FormEvent): Promise<void> {
    e.preventDefault();
    if (reason.trim().length < 3) {
      setError('Reason must be at least 3 characters.');
      return;
    }
    setError(null);
    try {
      await mut.mutateAsync({ productionId, reason: reason.trim() });
      onClose();
    } catch (err) {
      if (err instanceof RevertProductionError) {
        switch (err.code) {
          case 'forbidden':           setError('Admin permission required.'); break;
          case 'production_too_old':  setError('Production is older than 24h ; cannot be reverted.'); break;
          case 'already_reverted':    setError('Already reverted.'); break;
          default:                    setError(err.message);
        }
      } else {
        setError('Failed to revert.');
      }
    }
  }

  return (
    <Dialog open onOpenChange={(o) => { if (!o) onClose(); }}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>Revert production {productionNumber}</DialogTitle>
          <DialogDescription>
            Stock will be restored and a counter-JE posted. Requires admin permission
            and a production date within the last 24 hours.
          </DialogDescription>
        </DialogHeader>

        <form onSubmit={(e) => { void handleSubmit(e); }} className="space-y-3">
          <div className="space-y-1">
            <label htmlFor="revert-reason" className="text-xs uppercase tracking-widest text-text-secondary">
              Reason
            </label>
            <Input
              id="revert-reason"
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              maxLength={200}
              autoFocus
            />
          </div>
          {error !== null && <div role="alert" className="text-red text-xs">{error}</div>}

          <DialogFooter>
            <Button type="button" variant="ghost" onClick={onClose}>Cancel</Button>
            <Button type="submit" variant="primary" disabled={mut.isPending}>
              {mut.isPending ? 'Reverting…' : 'Revert'}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
