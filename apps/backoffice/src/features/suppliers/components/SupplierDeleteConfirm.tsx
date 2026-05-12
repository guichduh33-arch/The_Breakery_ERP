// apps/backoffice/src/features/suppliers/components/SupplierDeleteConfirm.tsx
import { useState } from 'react';
import {
  Button,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogTitle,
} from '@breakery/ui';
import { useDeleteSupplier } from '../hooks/useDeleteSupplier.js';
import type { SupplierRow } from '../hooks/useSuppliersList.js';

export interface SupplierDeleteConfirmProps {
  open: boolean;
  row: SupplierRow | undefined;
  onClose: () => void;
}

export function SupplierDeleteConfirm({ open, row, onClose }: SupplierDeleteConfirmProps) {
  const deleteMut = useDeleteSupplier();
  const [error, setError] = useState<string | null>(null);

  async function handleConfirm() {
    if (row === undefined) return;
    setError(null);
    try {
      await deleteMut.mutateAsync(row.id);
      onClose();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to delete supplier');
    }
  }

  return (
    <Dialog open={open} onOpenChange={(o) => { if (!o) onClose(); }}>
      <DialogContent>
        <DialogTitle>Soft-delete supplier</DialogTitle>
        <DialogDescription>
          {row !== undefined ? (
            <>
              Supplier <span className="text-text-primary font-semibold">{row.name}</span> ({row.code}) will be
              hidden from the list. Historical stock movements that reference it stay intact.
            </>
          ) : null}
        </DialogDescription>
        {error !== null && <p className="text-sm text-red" role="alert">{error}</p>}
        <DialogFooter className="gap-2">
          <Button type="button" variant="secondary" onClick={onClose} disabled={deleteMut.isPending}>Cancel</Button>
          <Button type="button" variant="primary" className="bg-red hover:bg-red/80"
            onClick={() => { void handleConfirm(); }} disabled={deleteMut.isPending}>
            {deleteMut.isPending ? 'Deleting…' : 'Confirm delete'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
