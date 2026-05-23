// apps/backoffice/src/features/products/components/ConvertToParentDialog.tsx
//
// Session 27c — Modal to convert a standalone product into a parent with the
// first variant. Calls `convert_product_to_parent_v1` via the
// `useConvertProductToParent` hook. The original product becomes the first
// variant under the newly-created parent grouping.

import { useState, type JSX } from 'react';
import {
  Button,
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from '@breakery/ui';
import { useConvertProductToParent } from '../hooks/useConvertProductToParent.js';

export interface ConvertToParentDialogProps {
  open:          boolean;
  onOpenChange:  (open: boolean) => void;
  productId:     string;
  productName:   string;
  onConverted?:  (parentId: string) => void;
}

type Axis = 'flavor' | 'size' | 'format';

const AXES: ReadonlyArray<{ value: Axis; label: string }> = [
  { value: 'flavor', label: 'Flavor' },
  { value: 'size',   label: 'Size'   },
  { value: 'format', label: 'Format' },
];

export function ConvertToParentDialog({
  open, onOpenChange, productId, productName, onConverted,
}: ConvertToParentDialogProps): JSX.Element {
  const [axis,         setAxis]         = useState<Axis>('flavor');
  const [label,        setLabel]        = useState('');
  const [overrideName, setOverrideName] = useState(false);
  const [customName,   setCustomName]   = useState('');
  const [error,        setError]        = useState<string | null>(null);

  const mutation = useConvertProductToParent();

  function resetForm(): void {
    setAxis('flavor');
    setLabel('');
    setOverrideName(false);
    setCustomName('');
    setError(null);
  }

  async function submit(): Promise<void> {
    setError(null);
    if (label.trim().length === 0) {
      setError('Label is required.');
      return;
    }
    try {
      const newParentId = await mutation.mutateAsync({
        productId,
        firstVariantLabel: label.trim(),
        variantAxis:       axis,
        firstVariantName:  overrideName && customName.trim().length > 0 ? customName.trim() : null,
      });
      resetForm();
      onOpenChange(false);
      if (onConverted !== undefined) onConverted(newParentId);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Conversion failed.');
    }
  }

  function handleOpenChange(o: boolean): void {
    if (!o) {
      resetForm();
    }
    onOpenChange(o);
  }

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent className="max-w-md" data-testid="convert-to-parent-dialog">
        <DialogHeader>
          <DialogTitle>Convert "{productName}" to a parent</DialogTitle>
          <DialogDescription>
            "{productName}" becomes the first variant under a new parent grouping.
            Pick the axis and the label that distinguishes this first variant.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-3">
          <div>
            <label className="block text-xs uppercase tracking-wider text-text-secondary mb-1">
              Axis
            </label>
            <div role="group" aria-label="Variant axis" className="inline-flex gap-1 rounded-full border border-border-subtle bg-bg-elevated p-1">
              {AXES.map((a) => (
                <button
                  key={a.value}
                  type="button"
                  data-testid={`convert-axis-${a.value}`}
                  onClick={() => setAxis(a.value)}
                  aria-pressed={axis === a.value}
                  className={
                    axis === a.value
                      ? 'px-3 py-1 text-xs font-semibold rounded-full bg-gold-soft text-gold'
                      : 'px-3 py-1 text-xs font-semibold rounded-full text-text-muted hover:text-text-primary'
                  }
                >
                  {a.label}
                </button>
              ))}
            </div>
          </div>

          <div>
            <label htmlFor="convert-first-label" className="block text-xs uppercase tracking-wider text-text-secondary mb-1">
              First variant label
            </label>
            <input
              id="convert-first-label"
              data-testid="first-variant-label"
              value={label}
              onChange={(e) => setLabel(e.target.value)}
              placeholder={axis === 'flavor' ? 'ex: Nature' : axis === 'size' ? 'ex: 250g' : 'ex: Whole'}
              className="w-full px-2 py-2 text-sm bg-bg-base border border-border-subtle rounded"
              maxLength={64}
            />
          </div>

          <div className="space-y-1.5">
            <label className="flex items-center gap-2 text-xs text-text-secondary">
              <input
                type="checkbox"
                checked={overrideName}
                onChange={(e) => setOverrideName(e.target.checked)}
                data-testid="convert-override-name"
              />
              <span>Override the first variant&apos;s name (default: keep "{productName}")</span>
            </label>
            {overrideName && (
              <input
                value={customName}
                onChange={(e) => setCustomName(e.target.value)}
                placeholder={`${productName} ${label.length > 0 ? label : '<label>'}`}
                className="w-full px-2 py-2 text-sm bg-bg-base border border-border-subtle rounded"
                maxLength={120}
                data-testid="convert-custom-name"
              />
            )}
          </div>

          {error !== null && (
            <div data-testid="convert-dialog-error" className="text-xs text-red bg-red-soft px-2 py-1.5 rounded">
              {error}
            </div>
          )}
        </div>

        <DialogFooter>
          <Button variant="ghost" onClick={() => handleOpenChange(false)} disabled={mutation.isPending}>
            Cancel
          </Button>
          <Button
            data-testid="convert-dialog-submit"
            onClick={() => { void submit(); }}
            disabled={mutation.isPending || label.trim().length === 0}
          >
            {mutation.isPending ? 'Converting…' : 'Convert + create first variant'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
