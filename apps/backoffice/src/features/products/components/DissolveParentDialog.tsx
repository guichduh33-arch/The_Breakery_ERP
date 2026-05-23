// apps/backoffice/src/features/products/components/DissolveParentDialog.tsx
//
// Session 27c — Confirm dialog for dissolving a parent product. Triggers
// `convert_parent_to_standalone_v1`, which collapses the parent grouping back
// into a single standalone product (using the last active variant when one
// remains, or the parent SKU otherwise).

import { useState, type JSX } from 'react';
import {
  Button,
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from '@breakery/ui';
import { useConvertParentToStandalone } from '../hooks/useConvertParentToStandalone.js';

export interface DissolveParentDialogProps {
  open:             boolean;
  onOpenChange:     (open: boolean) => void;
  parentId:         string;
  parentName:       string;
  lastVariantName?: string | null;
  onDissolved?:     (survivingProductId: string) => void;
}

export function DissolveParentDialog({
  open, onOpenChange, parentId, parentName, lastVariantName, onDissolved,
}: DissolveParentDialogProps): JSX.Element {
  const mutation = useConvertParentToStandalone();
  const [error, setError] = useState<string | null>(null);

  async function confirm(): Promise<void> {
    setError(null);
    try {
      const survivingId = await mutation.mutateAsync(parentId);
      onOpenChange(false);
      if (onDissolved !== undefined) onDissolved(survivingId);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Dissolve failed.');
    }
  }

  function handleOpenChange(o: boolean): void {
    if (!o) setError(null);
    onOpenChange(o);
  }

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent className="max-w-md" data-testid="dissolve-parent-dialog">
        <DialogHeader>
          <DialogTitle>Dissolve "{parentName}"</DialogTitle>
          <DialogDescription>
            {lastVariantName !== undefined && lastVariantName !== null && lastVariantName.length > 0
              ? `"${lastVariantName}" will become a standalone product. The parent grouping will be removed.`
              : 'The parent grouping will be removed (no active variants remain).'}
          </DialogDescription>
        </DialogHeader>

        {error !== null && (
          <div data-testid="dissolve-error" className="text-xs text-red bg-red-soft px-2 py-1.5 rounded">
            {error}
          </div>
        )}

        <DialogFooter>
          <Button variant="ghost" onClick={() => handleOpenChange(false)} disabled={mutation.isPending}>
            Cancel
          </Button>
          <Button
            data-testid="dissolve-confirm"
            onClick={() => { void confirm(); }}
            disabled={mutation.isPending}
          >
            {mutation.isPending ? 'Dissolving…' : 'Dissolve'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
