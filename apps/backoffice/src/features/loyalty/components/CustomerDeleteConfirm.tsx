// apps/backoffice/src/features/loyalty/components/CustomerDeleteConfirm.tsx
//
// Soft-delete confirmation. User must type the customer's name to confirm —
// same UX as PromotionDeleteConfirm. On RPC failure the dialog stays open
// and surfaces the error so the typed-name guard isn't silently lost.

import { useState } from 'react';
import { Dialog, DialogContent, DialogDescription, DialogTitle, Button, Input } from '@breakery/ui';
import { useDeleteCustomer } from '../hooks/useDeleteCustomer.js';
import type { CustomerListRow } from '../hooks/useLoyaltyCustomersList.js';

export interface CustomerDeleteConfirmProps {
  customer: CustomerListRow | undefined;
  onClose:  () => void;
}

export function CustomerDeleteConfirm({ customer, onClose }: CustomerDeleteConfirmProps) {
  const deleteMut = useDeleteCustomer();
  const [typed, setTyped] = useState('');
  const [formError, setFormError] = useState<string | null>(null);
  const open = customer !== undefined;
  const canConfirm = customer?.name !== undefined && typed === customer.name && !deleteMut.isPending;

  function handleClose(): void {
    setTyped('');
    setFormError(null);
    onClose();
  }

  async function handleConfirm(): Promise<void> {
    if (customer === undefined) return;
    setFormError(null);
    try {
      await deleteMut.mutateAsync(customer.id);
      handleClose();
    } catch (err) {
      setFormError(err instanceof Error ? err.message : 'Delete failed. Please retry.');
    }
  }

  return (
    <Dialog open={open} onOpenChange={(o) => { if (!o) handleClose(); }}>
      <DialogContent className="max-w-md space-y-4">
        <DialogTitle>Delete customer</DialogTitle>
        <DialogDescription>
          Type <span className="font-mono">{customer?.name}</span> to confirm. This soft-deletes the customer; their loyalty ledger is preserved.
        </DialogDescription>
        {formError !== null && (
          <div role="alert" className="rounded-md border border-red bg-red/5 p-2 text-xs text-red">
            {formError}
          </div>
        )}
        <Input value={typed} onChange={(e) => setTyped(e.target.value)} placeholder={customer?.name ?? ''} />
        <div className="flex justify-end gap-2">
          <Button variant="ghost" onClick={handleClose}>Cancel</Button>
          <Button variant="primary" disabled={!canConfirm} onClick={() => { void handleConfirm(); }}>Delete</Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
