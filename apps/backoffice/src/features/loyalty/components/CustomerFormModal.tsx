// apps/backoffice/src/features/loyalty/components/CustomerFormModal.tsx
//
// Modal that wraps the shared <CustomerForm> from @breakery/ui. Owns the
// create/update mutations and closes on success.

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

  async function handleSubmit(values: CustomerFormValues): Promise<void> {
    if (mode === 'create') {
      await createMut.mutateAsync(values);
    } else if (initial !== undefined) {
      await updateMut.mutateAsync({ id: initial.id, values });
    }
    onClose();
  }

  return (
    <Dialog open={open} onOpenChange={(o) => { if (!o) onClose(); }}>
      <DialogContent className="max-w-md">
        <DialogTitle>{mode === 'create' ? 'New customer' : 'Edit customer'}</DialogTitle>
        <DialogDescription className="sr-only">
          Customer details (name, phone, email).
        </DialogDescription>
        <CustomerForm
          mode={mode}
          {...(mode === 'edit' && initial !== undefined
            ? { initialValues: { name: initial.name, phone: initial.phone, email: initial.email } }
            : {})}
          onSubmit={handleSubmit}
          onCancel={onClose}
          submitting={createMut.isPending || updateMut.isPending}
        />
      </DialogContent>
    </Dialog>
  );
}
