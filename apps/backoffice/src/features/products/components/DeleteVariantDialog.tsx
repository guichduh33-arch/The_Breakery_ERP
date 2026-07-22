// apps/backoffice/src/features/products/components/DeleteVariantDialog.tsx
//
// ADR-011 §3 — confirm dialog for soft-deleting a variant. The Delete button
// in the variants table used to fire `delete_variant_v1` on a single click
// with no confirmation and no error surface. Mirrors DissolveParentDialog:
// the mutation lives here, errors render inline, the dialog closes only on
// success.

import { useState, type JSX } from 'react';
import {
  Button,
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from '@breakery/ui';
import { useDeleteVariant } from '../hooks/useDeleteVariant.js';

export interface DeleteVariantDialogProps {
  /** Variant to delete, or null when the dialog is closed. */
  variant:      { id: string; variant_label: string } | null;
  onOpenChange: (open: boolean) => void;
}

export function DeleteVariantDialog({
  variant, onOpenChange,
}: DeleteVariantDialogProps): JSX.Element {
  const mutation = useDeleteVariant();
  const [error, setError] = useState<string | null>(null);

  async function confirm(): Promise<void> {
    if (variant === null) return;
    setError(null);
    try {
      await mutation.mutateAsync(variant.id);
      onOpenChange(false);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Delete failed.');
    }
  }

  function handleOpenChange(o: boolean): void {
    if (!o) setError(null);
    onOpenChange(o);
  }

  return (
    <Dialog open={variant !== null} onOpenChange={handleOpenChange}>
      <DialogContent className="max-w-md" data-testid="delete-variant-dialog">
        <DialogHeader>
          <DialogTitle>Delete "{variant?.variant_label ?? ''}"</DialogTitle>
          <DialogDescription>
            The variant will be deactivated and disappear from the POS. Past
            orders keep referencing it (soft delete).
          </DialogDescription>
        </DialogHeader>

        {error !== null && (
          <div data-testid="delete-variant-error" className="text-xs text-red bg-red-soft px-2 py-1.5 rounded">
            {error}
          </div>
        )}

        <DialogFooter>
          <Button variant="ghost" onClick={() => handleOpenChange(false)} disabled={mutation.isPending}>
            Cancel
          </Button>
          <Button
            data-testid="delete-variant-confirm"
            onClick={() => { void confirm(); }}
            disabled={mutation.isPending}
          >
            {mutation.isPending ? 'Deleting…' : 'Delete'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
