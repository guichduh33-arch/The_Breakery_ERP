// apps/backoffice/src/features/products/components/EditVariantLabelDialog.tsx
//
// S3-14 — Édition du libellé d'une variante. La RPC `update_variant_v2` et
// son crochet existaient sans aucun appelant. Même gabarit que
// DeleteVariantDialog : la mutation vit ici, l'erreur s'affiche en ligne, le
// dialogue ne se ferme qu'en cas de succès. Le libellé est rogné et ne peut
// pas être vide (la RPC garderait l'ancien sur un NULL, pas sur une chaîne
// vide).

import { useEffect, useState, type JSX } from 'react';
import { Dialog, DialogDescription } from '@breakery/ui';
import { Button, DialogContent, DialogFooter, DialogHeader, DialogTitle } from '@/components/BackofficeUi.js';
import { FOCUS_RING } from '@/components/focusRing.js';
import { useUpdateVariant } from '../hooks/useUpdateVariant.js';

export interface EditVariantLabelDialogProps {
  /** Variante à renommer, ou null quand le dialogue est fermé. */
  variant:      { id: string; variant_label: string } | null;
  onOpenChange: (open: boolean) => void;
}

export function EditVariantLabelDialog({
  variant, onOpenChange,
}: EditVariantLabelDialogProps): JSX.Element {
  const mutation = useUpdateVariant();
  const [label, setLabel] = useState('');
  const [error, setError] = useState<string | null>(null);

  // Chaque ouverture repart du libellé courant de la variante ciblée.
  useEffect(() => {
    if (variant !== null) {
      setLabel(variant.variant_label);
      setError(null);
    }
  }, [variant]);

  async function submit(): Promise<void> {
    if (variant === null) return;
    const trimmed = label.trim();
    if (trimmed === '') {
      setError('Label is required.');
      return;
    }
    if (trimmed === variant.variant_label) {
      onOpenChange(false);
      return;
    }
    setError(null);
    try {
      await mutation.mutateAsync({ variantId: variant.id, patch: { variant_label: trimmed } });
      onOpenChange(false);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Update failed.');
    }
  }

  function handleOpenChange(o: boolean): void {
    if (!o) setError(null);
    onOpenChange(o);
  }

  return (
    <Dialog open={variant !== null} onOpenChange={handleOpenChange}>
      <DialogContent className="max-w-md" data-testid="edit-variant-dialog">
        <DialogHeader>
          <DialogTitle>Rename "{variant?.variant_label ?? ''}"</DialogTitle>
          <DialogDescription>
            Only the variant label changes. Price, SKU and stock stay as they are.
          </DialogDescription>
        </DialogHeader>

        <form
          className="space-y-3"
          onSubmit={(e) => { e.preventDefault(); void submit(); }}
        >
          <div>
            <label htmlFor="edit-var-label" className="font-data font-semibold block text-xs uppercase tracking-wider text-text-secondary mb-1">
              Label
            </label>
            <input
              id="edit-var-label"
              data-testid="edit-variant-label"
              value={label}
              onChange={(e) => setLabel(e.target.value)}
              className={`w-full px-2 py-2 text-sm bg-bg-base border border-border-strong rounded ${FOCUS_RING}`}
              maxLength={64}
              aria-invalid={error !== null}
              aria-describedby={error !== null ? 'edit-var-label-error' : undefined}
            />
          </div>

          {error !== null && (
            <div
              id="edit-var-label-error"
              role="alert"
              data-testid="edit-variant-error"
              className="text-xs text-red bg-red-soft px-2 py-1.5 rounded"
            >
              {error}
            </div>
          )}

          <DialogFooter>
            <Button type="button" variant="ghost" onClick={() => handleOpenChange(false)} disabled={mutation.isPending}>
              Cancel
            </Button>
            <Button
              type="submit"
              variant="ink"
              data-testid="edit-variant-submit"
              disabled={mutation.isPending}
            >
              {mutation.isPending ? 'Saving…' : 'Save label'}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
