// apps/backoffice/src/features/expenses/components/PayDialog.tsx
import { useState } from 'react';
import { Dialog, DialogDescription, Select } from '@breakery/ui';
import { Button, DialogContent, DialogFooter, DialogHeader, DialogTitle } from '@/components/BackofficeUi.js';
import { usePayExpense } from '../hooks/useExpenseActions.js';

export interface PayDialogProps {
  open: boolean;
  expenseId: string;
  recordedPaymentMethod: string;
  onClose: () => void;
  onSuccess?: () => void;
}

export function PayDialog({ open, expenseId, recordedPaymentMethod, onClose, onSuccess }: PayDialogProps): JSX.Element {
  const [method, setMethod] = useState<'cash' | 'transfer' | 'card'>('cash');
  const mut = usePayExpense();
  const isCredit = recordedPaymentMethod === 'credit';
  const recordedLabel = ({ cash: 'Cash', transfer: 'Bank transfer', card: 'Card' } as Record<string, string>)[recordedPaymentMethod] ?? recordedPaymentMethod;

  async function handleSubmit(): Promise<void> {
    try {
      await mut.mutateAsync({ id: expenseId, ...(isCredit ? { paymentMethod: method } : {}) });
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
{isCredit ? 'Choose how to settle this credit expense.' : 'The recorded payment method is fixed at approval.'}
          </DialogDescription>
        </DialogHeader>
        {isCredit ? <div className="space-y-1">
          <label htmlFor="pay-method" className="font-data font-semibold text-xs uppercase tracking-widest text-text-secondary">
            Payment method
          </label>
          <Select
            id="pay-method"
            value={method}
            onChange={(e) => setMethod(e.target.value as typeof method)}
            className="w-full"
          >
            <option value="cash">Cash</option>
            <option value="transfer">Bank transfer</option>
            <option value="card">Card</option>
          </Select>
        </div> : <div className="space-y-1">
          <p className="text-sm text-text-secondary">Recorded payment method</p>
          <p className="font-medium text-text-primary">{recordedLabel}</p>
        </div>}
        {mut.error !== null && mut.error !== undefined && (
          <div className="text-xs text-red">{mut.error.message}</div>
        )}
        <DialogFooter>
          <Button type="button" variant="ghost" onClick={onClose}>Cancel</Button>
          <Button type="button" variant="ink" onClick={() => { void handleSubmit(); }} disabled={mut.isPending}>
            {mut.isPending ? 'Marking…' : 'Mark paid'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
