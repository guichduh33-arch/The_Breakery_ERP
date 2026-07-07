// apps/backoffice/src/features/promotions/components/PromotionDeleteConfirm.tsx
//
// Soft-delete confirmation. Reminds the user that the promo is preserved for
// audit reporting (promotion_applications history stays intact).
//
// Spec ref: docs/superpowers/specs/2026-05-10-session-9-promotions-spec.md §3.5, §7

import { useState } from 'react';
import {
  Button,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogTitle,
} from '@breakery/ui';
import { useDeletePromotion } from '../hooks/useDeletePromotion.js';
import type { PromotionListRow } from '../hooks/usePromotionsList.js';

export interface PromotionDeleteConfirmProps {
  open: boolean;
  row: PromotionListRow | undefined;
  onClose: () => void;
}

export function PromotionDeleteConfirm({ open, row, onClose }: PromotionDeleteConfirmProps) {
  const deleteMut = useDeletePromotion();
  const [error, setError] = useState<string | null>(null);

  async function handleConfirm(): Promise<void> {
    if (row === undefined) return;
    setError(null);
    try {
      await deleteMut.mutateAsync(row.id);
      onClose();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to delete promotion');
    }
  }

  return (
    <Dialog open={open} onOpenChange={(o) => { if (!o) onClose(); }}>
      <DialogContent>
        <DialogTitle>Soft-delete promotion</DialogTitle>
        <DialogDescription>
          {row !== undefined ? (
            <>
              Promotion <span className="text-text-primary font-semibold">{row.name}</span> will be
              hidden from the list and stop applying at checkout. Past applications stay intact for
              reporting.
            </>
          ) : null}
        </DialogDescription>
        {error !== null && (
          <p className="text-sm text-danger" role="alert">
            {error}
          </p>
        )}
        <DialogFooter className="gap-2">
          <Button type="button" variant="secondary" onClick={onClose} disabled={deleteMut.isPending}>
            Cancel
          </Button>
          <Button
            type="button"
            variant="primary"
            className="bg-danger hover:bg-danger/80"
            onClick={() => { void handleConfirm(); }}
            disabled={deleteMut.isPending}
          >
            {deleteMut.isPending ? 'Deleting…' : 'Confirm delete'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
