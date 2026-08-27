// apps/backoffice/src/features/products/components/DeleteProductDialog.tsx
//
// Session 45 — Wave B — Confirmation dialog for soft-deleting a product.
//
// Soft-delete: the product is deactivated (hidden from catalog & POS),
// but all historical order data is preserved (orders reference the snapshot).
//
// Dialog is controlled by the parent via `product` (null = closed, non-null = open).
// Calls useDeleteProduct internally and surfaces errors via toast + inline message.
//
// Pattern mirrors DissolveParentDialog + CorrectCostDialog (S27c / S39 W-B2).
//
// Copy is in ENGLISH like the rest of the back-office (audit UX/UI 2026-08-13) —
// and it says DEACTIVATE, not delete: the row action is destructive-looking, the
// effect is reversible from the product detail page.

import { useState, type JSX } from 'react';
import { toast } from 'sonner';
import {
  Button,
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from '@breakery/ui';
import { useDeleteProduct } from '../hooks/useDeleteProduct.js';
import type { ProductRow } from '../types.js';

export interface DeleteProductDialogProps {
  /** The product to delete. When null the dialog is closed. */
  product: ProductRow | null;
  onClose: () => void;
}

export function DeleteProductDialog({ product, onClose }: DeleteProductDialogProps): JSX.Element {
  const mutation = useDeleteProduct();
  const [error, setError] = useState<string | null>(null);

  const open = product !== null;

  async function handleConfirm(): Promise<void> {
    if (product === null) return;
    setError(null);
    try {
      await mutation.mutateAsync({ productId: product.id });
      toast.success(`"${product.name}" has been deactivated.`);
      onClose();
    } catch (e) {
      const msg = e instanceof Error ? e.message : 'Deactivation failed.';
      setError(msg);
      toast.error(msg);
    }
  }

  function handleOpenChange(o: boolean): void {
    if (!o) {
      setError(null);
      onClose();
    }
  }

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent className="max-w-md" data-testid="delete-product-dialog">
        <DialogHeader>
          <DialogTitle>Deactivate "{product?.name ?? ''}"</DialogTitle>
          <DialogDescription>
            The product will be hidden from the catalogue and the POS (soft delete). Past
            orders are preserved. SKU: <code className="font-mono text-xs">{product?.sku ?? ''}</code>
          </DialogDescription>
        </DialogHeader>

        <div
          className="rounded bg-red-soft border border-red px-3 py-2 text-sm text-red"
          role="note"
          aria-label="Warning"
        >
          The product stays deactivated until someone reactivates it by hand from the
          product detail page.
        </div>

        {error !== null && (
          <div
            data-testid="delete-product-error"
            className="rounded bg-red-soft px-2 py-1.5 text-xs text-red"
          >
            {error}
          </div>
        )}

        <DialogFooter>
          <Button
            variant="ghost"
            onClick={() => handleOpenChange(false)}
            disabled={mutation.isPending}
            data-testid="delete-product-cancel"
          >
            Cancel
          </Button>
          <Button
            variant="ink"
            data-testid="delete-product-confirm"
            onClick={() => { void handleConfirm(); }}
            disabled={mutation.isPending}
            className="bg-danger text-danger-fg hover:bg-danger-hover"
          >
            {mutation.isPending ? 'Deactivating…' : 'Deactivate product'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
