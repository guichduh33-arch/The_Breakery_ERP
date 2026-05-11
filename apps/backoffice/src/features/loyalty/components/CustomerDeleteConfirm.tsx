// apps/backoffice/src/features/loyalty/components/CustomerDeleteConfirm.tsx
//
// Soft-delete confirmation. User must type the customer's name to confirm —
// same UX as PromotionDeleteConfirm.

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
  const open = customer !== undefined;
  const canConfirm = customer?.name !== undefined && typed === customer.name && !deleteMut.isPending;

  async function handleConfirm(): Promise<void> {
    if (customer === undefined) return;
    await deleteMut.mutateAsync(customer.id);
    setTyped('');
    onClose();
  }

  return (
    <Dialog open={open} onOpenChange={(o) => { if (!o) { setTyped(''); onClose(); } }}>
      <DialogContent className="max-w-md space-y-4">
        <DialogTitle>Delete customer</DialogTitle>
        <DialogDescription>
          Type <span className="font-mono">{customer?.name}</span> to confirm. This soft-deletes the customer; their loyalty ledger is preserved.
        </DialogDescription>
        <Input value={typed} onChange={(e) => setTyped(e.target.value)} placeholder={customer?.name ?? ''} />
        <div className="flex justify-end gap-2">
          <Button variant="ghost" onClick={() => { setTyped(''); onClose(); }}>Cancel</Button>
          <Button variant="primary" disabled={!canConfirm} onClick={() => { void handleConfirm(); }}>Delete</Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
