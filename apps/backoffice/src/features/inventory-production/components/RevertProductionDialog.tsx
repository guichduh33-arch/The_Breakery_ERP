// apps/backoffice/src/features/inventory-production/components/RevertProductionDialog.tsx
//
// Minimal modal asking for a reason then calling revert_production_v2.
// ADMIN+ only — server enforces ; this UI shows the button regardless and
// surfaces the `forbidden` error inline.
//
// ADR-008 D7 — quand le stock produit est déjà ressorti, le serveur refuse
// (`already_consumed`) et renvoie la liste des sorties. On les affiche et on
// nomme le chemin de correction — un ajustement de stock : un refus sans issue
// laisserait le gestionnaire bloqué devant une fournée qu'il doit corriger.
//
// Phase 4.D — migrated from ad-hoc <div> overlay to @breakery/ui Radix Dialog.

import { useState, type FormEvent, type JSX } from 'react';
import {
  Button, Input,
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from '@breakery/ui';
import {
  useRevertProduction, RevertProductionError, type RevertBlocker,
} from '../hooks/useRevertProduction.js';

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
  const [blockers, setBlockers] = useState<RevertBlocker[] | null>(null);
  const mut = useRevertProduction();

  async function handleSubmit(e: FormEvent): Promise<void> {
    e.preventDefault();
    if (reason.trim().length < 3) {
      setError('Reason must be at least 3 characters.');
      return;
    }
    setError(null);
    setBlockers(null);
    try {
      await mut.mutateAsync({ productionId, reason: reason.trim() });
      onClose();
    } catch (err) {
      if (err instanceof RevertProductionError) {
        switch (err.code) {
          case 'forbidden':           setError('Admin permission required.'); break;
          case 'production_too_old':  setError('Production is older than 24h ; cannot be reverted.'); break;
          case 'already_reverted':    setError('Already reverted.'); break;
          case 'already_consumed':
            setError('This batch has already left stock, so it can no longer be reverted — reverting would remove units that are no longer there. Correct it with a stock adjustment instead.');
            setBlockers(err.blockers ?? null);
            break;
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
          {error !== null && (
            <div role="alert" className="text-red text-xs space-y-1">
              <p>{error}</p>
              {blockers !== null && blockers.length > 0 && (
                <ul className="list-disc pl-4 text-text-secondary" data-testid="revert-blockers">
                  {blockers.map((b) => (
                    <li key={b.movement_id}>
                      {b.movement_type} {Math.abs(b.quantity)} — {new Date(b.occurred_at).toLocaleString()}
                    </li>
                  ))}
                </ul>
              )}
            </div>
          )}

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
