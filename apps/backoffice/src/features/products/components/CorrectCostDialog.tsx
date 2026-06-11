// apps/backoffice/src/features/products/components/CorrectCostDialog.tsx
//
// Session 39 — Wave B2 — Dialog to correct (override) cost_price via
// update_cost_price_v1 (S22). Shows current cost, takes new cost + reason.
// Idempotency flavor 2 (S25): idempotencyKeyRef owned by the parent (CostingPanel)
// and passed in as a prop; the parent resets it on success/dismiss.

import { useState, type JSX } from 'react';
import { toast } from 'sonner';
import {
  Button,
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from '@breakery/ui';
import { useCorrectCostPrice } from '../hooks/useCorrectCostPrice.js';

export interface CorrectCostDialogProps {
  open:           boolean;
  onOpenChange:   (open: boolean) => void;
  productId:      string;
  currentCost:    number;
  idempotencyKey: string;
  /** Called after a successful correction so the parent can regenerate the key. */
  onSuccess:      () => void;
}

function formatIdr(n: number): string {
  return n.toLocaleString('id-ID');
}

export function CorrectCostDialog({
  open,
  onOpenChange,
  productId,
  currentCost,
  idempotencyKey,
  onSuccess,
}: CorrectCostDialogProps): JSX.Element {
  const [newCost, setNewCost]   = useState<string>('');
  const [reason,  setReason]    = useState<string>('');
  const [error,   setError]     = useState<string | null>(null);

  const mutation = useCorrectCostPrice(productId);

  const newCostNum  = parseFloat(newCost);
  const costValid   = !isNaN(newCostNum) && newCostNum > 0;
  const reasonValid = reason.trim().length >= 5;
  const canSubmit   = costValid && reasonValid && !mutation.isPending;

  function resetForm(): void {
    setNewCost('');
    setReason('');
    setError(null);
  }

  function handleOpenChange(o: boolean): void {
    if (!o) resetForm();
    onOpenChange(o);
  }

  async function handleSubmit(): Promise<void> {
    setError(null);
    if (!costValid) {
      setError('New cost must be a positive number.');
      return;
    }
    if (!reasonValid) {
      setError('Reason must be at least 5 characters.');
      return;
    }
    try {
      const result = await mutation.mutateAsync({
        newCost:        newCostNum,
        reason:         reason.trim(),
        idempotencyKey,
      });
      toast.success(
        `Cost updated: Rp ${formatIdr(result.old_cost)} → Rp ${formatIdr(result.new_cost)}`,
      );
      resetForm();
      onSuccess();
      onOpenChange(false);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Cost correction failed.');
    }
  }

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent className="max-w-md" data-testid="correct-cost-dialog">
        <DialogHeader>
          <DialogTitle>Correct cost price</DialogTitle>
          <DialogDescription>
            Current WAC cost: <span className="font-mono font-semibold">Rp {formatIdr(currentCost)}</span>.
            Enter the corrected cost and a reason for the audit trail.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          <div>
            <label
              htmlFor="correct-cost-new"
              className="block text-xs uppercase tracking-wider text-text-secondary mb-1"
            >
              New cost (IDR)
            </label>
            <input
              id="correct-cost-new"
              data-testid="correct-cost-new-input"
              type="number"
              min={0.01}
              step="any"
              value={newCost}
              onChange={(e) => setNewCost(e.target.value)}
              placeholder="e.g. 8500"
              className="w-full px-3 py-2 text-sm font-mono bg-bg-base border border-border-subtle rounded focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-gold"
            />
          </div>

          <div>
            <label
              htmlFor="correct-cost-reason"
              className="block text-xs uppercase tracking-wider text-text-secondary mb-1"
            >
              Reason (min 5 chars)
            </label>
            <textarea
              id="correct-cost-reason"
              data-testid="correct-cost-reason-input"
              rows={3}
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              placeholder="e.g. WAC drift after bulk purchase at discounted rate"
              className="w-full px-3 py-2 text-sm bg-bg-base border border-border-subtle rounded resize-none focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-gold"
            />
          </div>

          {error !== null && (
            <div
              data-testid="correct-cost-error"
              className="text-xs text-red bg-red-soft px-3 py-2 rounded"
            >
              {error}
            </div>
          )}
        </div>

        <DialogFooter>
          <Button
            variant="ghost"
            onClick={() => handleOpenChange(false)}
            disabled={mutation.isPending}
          >
            Cancel
          </Button>
          <Button
            data-testid="correct-cost-submit"
            onClick={() => { void handleSubmit(); }}
            disabled={!canSubmit}
          >
            {mutation.isPending ? 'Saving…' : 'Save correction'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
