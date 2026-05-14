// apps/backoffice/src/features/expenses/components/RejectDialog.tsx
import { useState } from 'react';
import {
  Button,
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from '@breakery/ui';
import { useRejectExpense } from '../hooks/useExpenseActions.js';

export interface RejectDialogProps {
  open: boolean;
  expenseId: string;
  onClose: () => void;
  onSuccess?: () => void;
}

export function RejectDialog({ open, expenseId, onClose, onSuccess }: RejectDialogProps): JSX.Element {
  const [reason, setReason] = useState('');
  const mut = useRejectExpense();

  async function handleSubmit(): Promise<void> {
    if (reason.trim() === '') return;
    try {
      await mut.mutateAsync({ id: expenseId, reason: reason.trim() });
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
          <DialogTitle>Reject expense</DialogTitle>
          <DialogDescription>Provide a reason — it will be visible to the creator.</DialogDescription>
        </DialogHeader>
        <div className="space-y-1">
          <label htmlFor="reject-reason" className="text-xs uppercase tracking-widest text-text-secondary">
            Reason <span className="text-red">*</span>
          </label>
          <textarea
            id="reject-reason"
            value={reason}
            onChange={(e) => setReason(e.target.value)}
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
          <Button
            type="button"
            variant="ghostDestructive"
            onClick={() => { void handleSubmit(); }}
            disabled={mut.isPending || reason.trim() === ''}
          >
            {mut.isPending ? 'Rejecting…' : 'Reject'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
