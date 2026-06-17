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
      toast.success(`"${product.name}" a été désactivé.`);
      onClose();
    } catch (e) {
      const msg = e instanceof Error ? e.message : 'Suppression échouée.';
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
          <DialogTitle>Désactiver "{product?.name ?? ''}"</DialogTitle>
          <DialogDescription>
            Le produit sera masqué du catalogue et du POS (soft-delete). Les commandes
            historiques sont conservées. SKU : <code className="font-mono text-xs">{product?.sku ?? ''}</code>
          </DialogDescription>
        </DialogHeader>

        <div
          className="rounded bg-red-soft border border-red px-3 py-2 text-sm text-red"
          role="note"
          aria-label="Avertissement"
        >
          Cette action désactive le produit de façon permanente. Vous pourrez le réactiver
          manuellement depuis la page de détail.
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
            Annuler
          </Button>
          <Button
            data-testid="delete-product-confirm"
            onClick={() => { void handleConfirm(); }}
            disabled={mutation.isPending}
            className="bg-red text-white hover:bg-red/90"
          >
            {mutation.isPending ? 'Désactivation…' : 'Désactiver le produit'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
