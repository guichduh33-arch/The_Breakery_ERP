// apps/backoffice/src/features/categories/components/DeleteCategoryDialog.tsx
// Confirm dialog for soft-deleting a product category.

import { useState, type JSX } from 'react';
import {
  Button,
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from '@breakery/ui';
import { AlertTriangle } from 'lucide-react';
import { useDeleteCategory } from '../hooks/useDeleteCategory.js';
import type { CategoryRow } from '../hooks/useAllCategories.js';

export interface DeleteCategoryDialogProps {
  category: CategoryRow;
  onClose:  () => void;
}

export function DeleteCategoryDialog({ category, onClose }: DeleteCategoryDialogProps): JSX.Element {
  const del = useDeleteCategory();
  const [error, setError] = useState<string | null>(null);

  function handleDelete(): void {
    setError(null);
    del.mutate(
      { categoryId: category.id },
      {
        onSuccess: () => onClose(),
        onError: (e) => setError(e.message),
      },
    );
  }

  return (
    <Dialog open onOpenChange={(o) => { if (!o) onClose(); }}>
      <DialogContent className="max-w-md" data-testid="delete-category-dialog">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <AlertTriangle className="h-5 w-5 text-red" aria-hidden />
            Delete category
          </DialogTitle>
          <DialogDescription>
            Delete <strong className="text-text-primary">{category.name}</strong>? It will be
            removed from the backoffice and the POS. Categories that still hold products can&apos;t
            be deleted.
          </DialogDescription>
        </DialogHeader>

        {error !== null && (
          <div role="alert" className="rounded-md border border-red/40 bg-red-soft px-3 py-2 text-sm text-red">
            {error}
          </div>
        )}

        <DialogFooter>
          <Button variant="ghost" onClick={onClose} disabled={del.isPending}>Cancel</Button>
          <Button
            variant="ghostDestructive"
            onClick={handleDelete}
            disabled={del.isPending}
            data-testid="delete-category-confirm"
          >
            {del.isPending ? 'Deleting…' : 'Delete'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
