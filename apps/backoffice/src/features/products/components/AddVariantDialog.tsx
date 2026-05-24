// apps/backoffice/src/features/products/components/AddVariantDialog.tsx
//
// Session 27c — Modal to add a new variant under an existing parent.
// Calls `create_variant_v1` via `useCreateVariant`.

import { useState, type JSX } from 'react';
import {
  Button,
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from '@breakery/ui';
import { useCreateVariant } from '../hooks/useCreateVariant.js';

export interface AddVariantDialogProps {
  open:         boolean;
  onOpenChange: (open: boolean) => void;
  parentId:     string;
  parentName:   string;
  onCreated?:   (variantId: string) => void;
}

export function AddVariantDialog({
  open, onOpenChange, parentId, parentName, onCreated,
}: AddVariantDialogProps): JSX.Element {
  const [label,       setLabel]       = useState('');
  const [sku,         setSku]         = useState('');
  const [retailPrice, setRetailPrice] = useState('');
  const [costPrice,   setCostPrice]   = useState('');
  const [error,       setError]       = useState<string | null>(null);

  const mutation = useCreateVariant();

  function reset(): void {
    setLabel('');
    setSku('');
    setRetailPrice('');
    setCostPrice('');
    setError(null);
  }

  async function submit(): Promise<void> {
    setError(null);
    if (label.trim().length === 0 || sku.trim().length === 0 || retailPrice.length === 0) {
      setError('Label, SKU and retail price are required.');
      return;
    }
    const rp = Number(retailPrice);
    if (!Number.isFinite(rp) || rp < 0) {
      setError('Retail price must be a non-negative number.');
      return;
    }
    let cp: number | null = null;
    if (costPrice.length > 0) {
      cp = Number(costPrice);
      if (!Number.isFinite(cp) || cp < 0) {
        setError('Cost price must be a non-negative number.');
        return;
      }
    }
    try {
      const newId = await mutation.mutateAsync({
        parentId,
        variantLabel: label.trim(),
        sku:          sku.trim().toUpperCase(),
        retailPrice:  rp,
        costPrice:    cp,
      });
      reset();
      onOpenChange(false);
      if (onCreated !== undefined) onCreated(newId);
    } catch (e) {
      const msg = e instanceof Error ? e.message : 'Create failed.';
      if (msg.includes('sku_taken')) {
        setError(`SKU "${sku.trim().toUpperCase()}" is already taken.`);
      } else {
        setError(msg);
      }
    }
  }

  function handleOpenChange(o: boolean): void {
    if (!o) reset();
    onOpenChange(o);
  }

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent className="max-w-md" data-testid="add-variant-dialog">
        <DialogHeader>
          <DialogTitle>Add variant to "{parentName}"</DialogTitle>
          <DialogDescription>
            Creates a new active variant under this parent. Cost price defaults
            to 0 if left blank — it will be filled by the next stock receipt
            (WAC).
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-3">
          <div>
            <label htmlFor="add-var-label" className="block text-xs uppercase tracking-wider text-text-secondary mb-1">
              Label
            </label>
            <input
              id="add-var-label"
              data-testid="add-variant-label"
              value={label}
              onChange={(e) => setLabel(e.target.value)}
              className="w-full px-2 py-2 text-sm bg-bg-base border border-border-subtle rounded"
              maxLength={64}
            />
          </div>

          <div>
            <label htmlFor="add-var-sku" className="block text-xs uppercase tracking-wider text-text-secondary mb-1">
              SKU
            </label>
            <input
              id="add-var-sku"
              data-testid="add-variant-sku"
              value={sku}
              onChange={(e) => setSku(e.target.value.toUpperCase())}
              className="w-full px-2 py-2 text-sm bg-bg-base border border-border-subtle rounded font-mono"
              maxLength={32}
            />
          </div>

          <div className="grid grid-cols-2 gap-2">
            <div>
              <label htmlFor="add-var-retail" className="block text-xs uppercase tracking-wider text-text-secondary mb-1">
                Retail price (IDR)
              </label>
              <input
                id="add-var-retail"
                data-testid="add-variant-retail"
                type="number"
                inputMode="numeric"
                min={0}
                value={retailPrice}
                onChange={(e) => setRetailPrice(e.target.value)}
                className="w-full px-2 py-2 text-sm bg-bg-base border border-border-subtle rounded font-mono"
              />
            </div>
            <div>
              <label htmlFor="add-var-cost" className="block text-xs uppercase tracking-wider text-text-secondary mb-1">
                Cost price (optional)
              </label>
              <input
                id="add-var-cost"
                data-testid="add-variant-cost"
                type="number"
                inputMode="numeric"
                min={0}
                value={costPrice}
                onChange={(e) => setCostPrice(e.target.value)}
                className="w-full px-2 py-2 text-sm bg-bg-base border border-border-subtle rounded font-mono"
              />
            </div>
          </div>

          {error !== null && (
            <div data-testid="add-variant-error" className="text-xs text-red bg-red-soft px-2 py-1.5 rounded">
              {error}
            </div>
          )}
        </div>

        <DialogFooter>
          <Button variant="ghost" onClick={() => handleOpenChange(false)} disabled={mutation.isPending}>
            Cancel
          </Button>
          <Button
            data-testid="add-variant-submit"
            onClick={() => { void submit(); }}
            disabled={mutation.isPending}
          >
            {mutation.isPending ? 'Saving…' : 'Add variant'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
