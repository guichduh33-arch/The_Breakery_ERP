// apps/backoffice/src/features/expenses/components/ApproveDialog.tsx
// S28: approve_expense_v2 — PIN collected in dialog, passed via x-manager-pin header (S25 pattern).
import { useState } from 'react';
import {
  Button,
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from '@breakery/ui';
import { useApproveExpense } from '../hooks/useExpenseActions.js';

export interface ApproveDialogProps {
  open: boolean;
  expenseId: string;
  onClose: () => void;
  onSuccess?: () => void;
}

export function ApproveDialog({ open, expenseId, onClose, onSuccess }: ApproveDialogProps): JSX.Element {
  const [pin, setPin] = useState('');
  const mut = useApproveExpense();

  function handleClose(): void {
    setPin('');
    mut.reset();
    onClose();
  }

  async function handleSubmit(): Promise<void> {
    if (pin.trim().length === 0) return;
    try {
      await mut.mutateAsync({ id: expenseId, manager_pin: pin.trim() });
      setPin('');
      onSuccess?.();
      onClose();
    } catch {
      // surfaced via mut.error
    }
  }

  return (
    <Dialog open={open} onOpenChange={(o) => { if (!o) handleClose(); }}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Approve expense</DialogTitle>
          <DialogDescription>
            Approval posts a balanced journal entry. Enter your manager PIN to confirm.
            This cannot be undone.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-1">
          <label htmlFor="approve-pin" className="text-xs uppercase tracking-widest text-text-secondary">
            Manager PIN
          </label>
          <input
            id="approve-pin"
            type="password"
            inputMode="numeric"
            maxLength={8}
            value={pin}
            onChange={(e) => setPin(e.target.value)}
            placeholder="••••••"
            className="w-full rounded-md border border-border-subtle bg-bg-input px-3 py-2 text-sm text-text-primary tracking-widest"
          />
        </div>
        {mut.error !== null && mut.error !== undefined && (
          <div className="text-xs text-red">{mut.error.message}</div>
        )}
        <DialogFooter>
          <Button type="button" variant="ghost" onClick={handleClose}>Cancel</Button>
          <Button
            type="button"
            variant="primary"
            onClick={() => { void handleSubmit(); }}
            disabled={mut.isPending || pin.trim().length === 0}
          >
            {mut.isPending ? 'Approving…' : 'Approve'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
