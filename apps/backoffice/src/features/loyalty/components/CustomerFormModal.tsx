// apps/backoffice/src/features/loyalty/components/CustomerFormModal.tsx
//
// Modal that wraps the shared <CustomerForm> from @breakery/ui. Owns the
// create/update mutations and closes on success. On mutation failure the
// modal stays open and surfaces the error as a banner — the user's input
// is preserved so they can retry.

import { useState } from 'react';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogTitle,
  CustomerForm,
  type CustomerFormValues,
} from '@breakery/ui';
import { useCreateCustomer } from '../hooks/useCreateCustomer.js';
import { useUpdateCustomer } from '../hooks/useUpdateCustomer.js';
import type { CustomerListRow } from '../hooks/useLoyaltyCustomersList.js';

export interface CustomerFormModalProps {
  open:      boolean;
  mode:      'create' | 'edit';
  initial?:  CustomerListRow;
  onClose:   () => void;
}

export function CustomerFormModal({ open, mode, initial, onClose }: CustomerFormModalProps) {
  const createMut = useCreateCustomer();
  const updateMut = useUpdateCustomer();
  const [formError, setFormError] = useState<string | null>(null);

  function handleClose(): void {
    setFormError(null);
    onClose();
  }

  async function handleSubmit(values: CustomerFormValues): Promise<void> {
    setFormError(null);
    try {
      if (mode === 'create') {
        await createMut.mutateAsync(values);
      } else if (initial !== undefined) {
        await updateMut.mutateAsync({ id: initial.id, values });
      }
      handleClose();
    } catch (err) {
      setFormError(err instanceof Error ? err.message : 'Something went wrong. Please retry.');
    }
  }

  return (
    <Dialog open={open} onOpenChange={(o) => { if (!o) handleClose(); }}>
      <DialogContent className="max-w-md">
        <DialogTitle>{mode === 'create' ? 'New customer' : 'Edit customer'}</DialogTitle>
        <DialogDescription className="sr-only">
          Customer details (name, phone, email).
        </DialogDescription>
        {formError !== null && (
          <div role="alert" className="rounded-md border border-red bg-red/5 p-2 text-xs text-red">
            {formError}
          </div>
        )}
        <CustomerForm
          mode={mode}
          {...(mode === 'edit' && initial !== undefined
            ? { initialValues: { name: initial.name, phone: initial.phone, email: initial.email } }
            : {})}
          onSubmit={handleSubmit}
          onCancel={handleClose}
          submitting={createMut.isPending || updateMut.isPending}
        />
      </DialogContent>
    </Dialog>
  );
}
