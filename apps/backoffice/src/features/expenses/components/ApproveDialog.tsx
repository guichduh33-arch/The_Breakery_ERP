// apps/backoffice/src/features/expenses/components/ApproveDialog.tsx
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
  const [notes, setNotes] = useState('');
  const mut = useApproveExpense();

  async function handleSubmit(): Promise<void> {
    try {
      const args: { id: string; notes?: string } = { id: expenseId };
      if (notes.trim() !== '') args.notes = notes.trim();
      await mut.mutateAsync(args);
      onSuccess?.();
      onClose();
    } catch {
      // surfaced via mut.error
    }
  }

  return (
    <Dialog open={open} onOpenChange={(o) => { if (!o) onClose(); }}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Approve expense</DialogTitle>
          <DialogDescription>
            Approval posts a balanced journal entry. This cannot be undone.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-1">
          <label htmlFor="approve-notes" className="text-xs uppercase tracking-widest text-text-secondary">
            Notes (optional)
          </label>
          <textarea
            id="approve-notes"
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            rows={3}
            maxLength={500}
            className="w-full rounded-md border border-border-subtle bg-bg-input px-3 py-2 text-sm text-text-primary"
          />
        </div>
        {mut.error !== null && mut.error !== undefined && (
          <div className="text-xs text-red">{mut.error.message}</div>
        )}
        <DialogFooter>
          <Button type="button" variant="ghost" onClick={onClose}>Cancel</Button>
          <Button type="button" variant="primary" onClick={() => { void handleSubmit(); }} disabled={mut.isPending}>
            {mut.isPending ? 'Approving…' : 'Approve'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
