// apps/backoffice/src/features/inventory-production/components/RecipeDuplicateModal.tsx
//
// Session 15 / Phase 3.B — Recipe duplication modal.
//
// Decision D9 (Spec 2026-05-15) : confirms a clone of every active recipe
// row from a source product to a target product that has NO active recipes.
// Surfaces server errors inline (`source_equals_target`,
// `target_has_active_recipes`, `recipe_cycle_detected`).

import { useMemo, useState, type JSX } from 'react';
import {
  Button,
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from '@breakery/ui';
import { useFinishedProducts } from '../hooks/useFinishedProducts.js';
import {
  useDuplicateRecipe,
  type DuplicateRecipeErrorCode,
} from '../hooks/useDuplicateRecipe.js';

export interface RecipeDuplicateModalProps {
  sourceProductId: string;
  /** Display name shown in the description. May be `undefined` when not loaded yet. */
  sourceProductName?: string | undefined;
  sourceRowsCount: number;
  open: boolean;
  onClose: () => void;
  onSuccess: (targetProductId: string) => void;
}

const ERROR_COPY: Record<DuplicateRecipeErrorCode, string> = {
  forbidden:                 'You do not have permission to duplicate recipes.',
  product_not_found:         'One of the products no longer exists.',
  source_equals_target:      'Source and target must be different.',
  target_has_active_recipes: 'Target product already has an active recipe — pick a product without one.',
  recipe_cycle_detected:     'Cloning would create a circular recipe graph. Pick a different target.',
  unknown:                   'Could not duplicate the recipe. Try again.',
};

export function RecipeDuplicateModal({
  sourceProductId,
  sourceProductName,
  sourceRowsCount,
  open,
  onClose,
  onSuccess,
}: RecipeDuplicateModalProps): JSX.Element | null {
  const products = useFinishedProducts();
  const duplicate = useDuplicateRecipe();
  const [targetId, setTargetId] = useState<string>('');

  // Only finished products without active recipes are valid targets.
  const targetOptions = useMemo(() => {
    return (products.data ?? []).filter(
      (p) => p.id !== sourceProductId && !p.has_active_recipe,
    );
  }, [products.data, sourceProductId]);

  const canConfirm =
    targetId !== '' &&
    targetId !== sourceProductId &&
    !duplicate.isPending;

  function handleConfirm(): void {
    if (!canConfirm) return;
    duplicate.mutate(
      { sourceProductId, targetProductId: targetId },
      {
        onSuccess: (result) => {
          onSuccess(result.target_product_id);
          setTargetId('');
        },
      },
    );
  }

  function handleOpenChange(o: boolean): void {
    if (!o) {
      setTargetId('');
      duplicate.reset();
      onClose();
    }
  }

  if (!open) return null;

  const errorCode: DuplicateRecipeErrorCode | null = duplicate.error
    ? duplicate.error.code
    : null;

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>Duplicate recipe</DialogTitle>
          <DialogDescription>
            Copies every active ingredient row from{' '}
            <span className="font-semibold text-text-primary">
              {sourceProductName ?? 'this product'}
            </span>{' '}
            ({sourceRowsCount} {sourceRowsCount === 1 ? 'row' : 'rows'}) to a
            target product that has no active recipe yet.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-3">
          <div className="space-y-1">
            <label
              htmlFor="duplicate-recipe-target"
              className="text-xs uppercase tracking-widest text-text-secondary"
            >
              Target product
            </label>
            <select
              id="duplicate-recipe-target"
              data-testid="duplicate-target-select"
              className="mt-1 h-9 w-full rounded-md border border-border-subtle bg-bg-input px-3 text-sm"
              value={targetId}
              onChange={(e) => setTargetId(e.target.value)}
              disabled={products.isLoading || duplicate.isPending}
            >
              <option value="">— select target product —</option>
              {targetOptions.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name} ({p.unit})
                </option>
              ))}
            </select>
            {targetOptions.length === 0 && !products.isLoading && (
              <p className="text-xs text-text-secondary" data-testid="no-target-hint">
                No products without active recipes available.
              </p>
            )}
          </div>

          {errorCode !== null && (
            <div
              className="rounded-md border border-red bg-red/10 px-3 py-2 text-sm text-red"
              role="alert"
              data-testid="duplicate-error"
              data-error-code={errorCode}
            >
              {ERROR_COPY[errorCode]}
            </div>
          )}
        </div>

        <DialogFooter>
          <Button type="button" variant="ghost" onClick={onClose} disabled={duplicate.isPending}>
            Cancel
          </Button>
          <Button
            type="button"
            variant="primary"
            onClick={handleConfirm}
            disabled={!canConfirm}
            data-testid="duplicate-confirm"
          >
            {duplicate.isPending ? 'Duplicating…' : 'Duplicate recipe'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export default RecipeDuplicateModal;
