// apps/backoffice/src/features/inventory-production/components/RevertProductionDialog.tsx
//
// Minimal modal asking for a reason then calling revert_production_v1.
// ADMIN+ only — server enforces ; this UI shows the button regardless and
// surfaces the `forbidden` error inline.

import { useState, type FormEvent, type JSX } from 'react';
import { Button, Input } from '@breakery/ui';
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
    <div
      role="dialog" aria-modal="true"
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/40"
      onClick={onClose}
    >
      <form
        onClick={(e) => e.stopPropagation()}
        onSubmit={(e) => { void handleSubmit(e); }}
        className="w-full max-w-md bg-bg-elevated rounded-lg border border-border-subtle p-6 space-y-4"
      >
        <h2 className="font-serif text-lg">Revert production {productionNumber}</h2>
        <p className="text-text-secondary text-sm">
          Stock will be restored and a counter-JE posted. Requires admin permission and
          production date within 24 hours.
        </p>
        <div className="space-y-1">
          <label className="text-xs uppercase tracking-widest text-text-secondary">Reason</label>
          <Input value={reason} onChange={(e) => setReason(e.target.value)} maxLength={200} autoFocus />
        </div>
        {error !== null && <div role="alert" className="text-red text-xs">{error}</div>}
        <div className="flex justify-end gap-2">
          <Button type="button" variant="ghost" onClick={onClose}>Cancel</Button>
          <Button type="submit" variant="primary" disabled={mut.isPending}>
            {mut.isPending ? 'Reverting…' : 'Revert'}
          </Button>
        </div>
      </form>
    </div>
  );
}
