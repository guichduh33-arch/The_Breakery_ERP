// apps/backoffice/src/features/expenses/components/PayDialog.tsx
import { useState } from 'react';
import {
  Button,
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from '@breakery/ui';
import { usePayExpense } from '../hooks/useExpenseActions.js';

export interface PayDialogProps {
  open: boolean;
  expenseId: string;
  onClose: () => void;
  onSuccess?: () => void;
}

export function PayDialog({ open, expenseId, onClose, onSuccess }: PayDialogProps): JSX.Element {
  const [method, setMethod] = useState<'cash' | 'transfer' | 'card'>('cash');
  const mut = usePayExpense();

  async function handleSubmit(): Promise<void> {
    try {
      await mut.mutateAsync({ id: expenseId, paymentMethod: method });
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
          <DialogTitle>Mark expense as paid</DialogTitle>
          <DialogDescription>
            For credit expenses, this posts a second JE clearing the AP.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-1">
          <label htmlFor="pay-method" className="text-xs uppercase tracking-widest text-text-secondary">
            Payment method
          </label>
          <select
            id="pay-method"
            value={method}
            onChange={(e) => setMethod(e.target.value as typeof method)}
            className="h-9 w-full rounded-md border border-border-subtle bg-bg-input px-3 text-sm text-text-primary"
          >
            <option value="cash">Cash</option>
            <option value="transfer">Bank transfer</option>
            <option value="card">Card</option>
          </select>
        </div>
        {mut.error !== null && mut.error !== undefined && (
          <div className="text-xs text-red">{mut.error.message}</div>
        )}
        <DialogFooter>
          <Button type="button" variant="ghost" onClick={onClose}>Cancel</Button>
          <Button type="button" variant="primary" onClick={() => { void handleSubmit(); }} disabled={mut.isPending}>
            {mut.isPending ? 'Marking…' : 'Mark paid'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
