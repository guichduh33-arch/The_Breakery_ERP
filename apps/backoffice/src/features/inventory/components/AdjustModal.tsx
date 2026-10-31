// apps/backoffice/src/features/inventory/components/AdjustModal.tsx
//
// Manual stock adjustment. Accepts an absolute new_qty (not a delta) +
// mandatory reason. Server-side validator mirrors @breakery/domain
// `validateAdjust`. Emits a `crypto.randomUUID()` idempotency key once at
// mount so the user can retry without doubling up.
//
// Supports two open patterns:
//   - From a row dropdown: pass `initialProduct` — typeahead is locked.
//   - From the toolbar:    pass `open` without initialProduct — typeahead is editable.

import { useEffect, useId, useState, type FormEvent, type JSX } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { Dialog, DialogDescription, Input } from '@breakery/ui';
import { Button, DialogContent, DialogTitle } from '@/components/BackofficeUi.js';
import { validateAdjust } from '@breakery/domain';
import { parseStockQuantity } from '../stockQuantity.js';
import { useAdjustStock, AdjustStockError } from '../hooks/useAdjustStock.js';
import { STOCK_LEVELS_QUERY_KEY, type StockLevelRow } from '../hooks/useStockLevels.js';
import type { ProductTypeaheadRow } from '../hooks/useProductsForInventory.js';
import { ProductTypeahead } from './ProductTypeahead.js';

export interface AdjustModalProps {
  open:             boolean;
  /** When provided, the typeahead is hidden and the product is locked. */
  initialProduct?:  StockLevelRow;
  onClose:          () => void;
}

const MAX_REASON = 500;

function stockLevelToTypeaheadRow(row: StockLevelRow): ProductTypeaheadRow {
  return { id: row.product_id, sku: row.sku, name: row.name, current_stock: row.current_stock, unit: row.unit };
}

export function AdjustModal({ open, initialProduct, onClose }: AdjustModalProps): JSX.Element {
  const adjustMut = useAdjustStock();
  const qc = useQueryClient();
  const reactId = useId();
  const productInputId = `${reactId}-product`;
  const newQtyId   = `${reactId}-newqty`;
  const newQtyErrId = `${reactId}-newqty-err`;
  const reasonId   = `${reactId}-reason`;
  const reasonHintId = `${reactId}-reason-hint`;

  const [product, setProduct] = useState<ProductTypeaheadRow | null>(
    initialProduct !== undefined ? stockLevelToTypeaheadRow(initialProduct) : null,
  );
  const [newQty, setNewQty] = useState<string>('');
  const [reason, setReason] = useState<string>('');
  const [formError, setFormError] = useState<string | null>(null);
  const [attemptLocked, setAttemptLocked] = useState(false);
  const [idempotencyKey, setIdempotencyKey] = useState<string>(() => crypto.randomUUID());

  // Reset internal state every time we open the modal afresh.
  useEffect(() => {
    if (open) {
      setProduct(initialProduct !== undefined ? stockLevelToTypeaheadRow(initialProduct) : null);
      setNewQty('');
      setAttemptLocked(false);
      setReason('');
      setFormError(null);
      setIdempotencyKey(crypto.randomUUID());
    }
    // initialProduct object identity changes on every parent render; depending on the primitive product_id
    // is the real signal — adding initialProduct itself would reset the modal on unrelated parent updates.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, initialProduct?.product_id]);

  const numericNewQty = parseStockQuantity(newQty) ?? Number.NaN;
  const isNewQtyValid = Number.isFinite(numericNewQty);
  const isReasonValid = reason.trim().length >= 3 && reason.trim().length <= MAX_REASON;

  const canSubmit = product !== null && isNewQtyValid && isReasonValid && !adjustMut.isPending;

  function handleClose(): void {
    if (attemptLocked || adjustMut.isPending) return;
    setFormError(null);
    onClose();
  }

  async function handleSubmit(e: FormEvent): Promise<void> {
    e.preventDefault();
    if (!canSubmit || product === null) return;

    const v = validateAdjust({
      productId: product.id,
      newQty:    numericNewQty,
      reason:    reason.trim(),
      idempotencyKey,
    });
    if (!v.ok) {
      setFormError(`Invalid input: ${v.error}.`);
      return;
    }

    setFormError(null);
    setAttemptLocked(true);
    try {
      const res = await adjustMut.mutateAsync({
        productId:      product.id,
        newQty:         numericNewQty,
        reason:         reason.trim(),
        idempotencyKey,
      });
      // La modale se refermait en silence : l'utilisateur n'avait aucune
      // confirmation que son comptage était enregistré, ni sous quel nom.
      const confirmation = res.status === 'pending'
        ? `Declaration ${res.idempotent_replay ? 'already submitted' : 'submitted'} — ${product.name}. Owner approval is required before stock changes.`
        : `Declaration already ${res.status} — ${product.name}. No new stock operation was recorded.`;
      if (res.idempotent_replay) toast.info(confirmation);
      else toast.success(confirmation);
      setAttemptLocked(false);
      onClose();
    } catch (err) {
      if (err instanceof AdjustStockError) {
        if (err.code !== 'unknown' && err.code !== 'idempotency_conflict') setAttemptLocked(false);
        switch (err.code) {
          case 'idempotency_conflict':
            setFormError('This request key belongs to different details. Check movement history before starting another operation.');
            break;
          case 'invalid_quantity':
            setFormError('Enter a valid quantity with up to 3 decimal places.');
            break;
          case 'forbidden':
            setFormError('You no longer have permission to adjust stock. Please refresh.');
            break;
          case 'product_not_found':
            setFormError('This product was deleted in another session. The list is being refreshed.');
            void qc.invalidateQueries({ queryKey: STOCK_LEVELS_QUERY_KEY });
            break;
          case 'negative_qty_not_allowed':
            setFormError('Quantity cannot be negative.');
            break;
          case 'reason_required':
            setFormError('Reason must be at least 3 characters.');
            break;
          default:
            setFormError('Something went wrong. Please retry.');
        }
      } else {
        setFormError('Something went wrong. Please retry.');
      }
    }
  }

  const isLockedProduct = initialProduct !== undefined;

  return (
    <Dialog open={open} onOpenChange={(o) => { if (!o) handleClose(); }}>
      <DialogContent className="max-w-md">
        <DialogTitle>
          Declare stock count {isLockedProduct && initialProduct !== undefined ? `— ${initialProduct.name}` : ''}
        </DialogTitle>
        <DialogDescription className="sr-only">
          Declare the physical quantity for independent owner approval. Stock stays unchanged until approval.
        </DialogDescription>

        <form onSubmit={(e) => { void handleSubmit(e); }} noValidate className="space-y-4">
          {formError !== null && (
            <div role="alert" className="rounded-md border border-red bg-red-soft p-2 text-xs text-red-as-text">
              {formError}
            </div>
          )}

          {attemptLocked && !adjustMut.isPending && (
            <p role="status" className="text-sm text-text-secondary">Details are locked. Retry sends the same request; check movement history before starting another operation.</p>
          )}
          <fieldset disabled={attemptLocked || adjustMut.isPending} className="space-y-4">
          {!isLockedProduct && (
            <div className="space-y-1">
              <label htmlFor={productInputId} className="font-data font-semibold text-xs uppercase tracking-widest text-text-secondary">
                Product
              </label>
              <ProductTypeahead
                id={productInputId}
                value={product}
                onChange={setProduct}
                disabled={adjustMut.isPending}
              />
            </div>
          )}


          <div className="space-y-1">
            <label htmlFor={newQtyId} className="font-data font-semibold text-xs uppercase tracking-widest text-text-secondary">
              New on-hand quantity {product?.unit ? `(${product.unit})` : ''}
            </label>
            <Input
              id={newQtyId}
              type="number"
              inputMode="decimal"
              min={0}
              step="0.001"
              value={newQty}
              onChange={(e) => setNewQty(e.target.value)}
              aria-invalid={newQty !== '' && !isNewQtyValid}
              aria-describedby={newQty !== '' && !isNewQtyValid ? newQtyErrId : undefined}
              disabled={product === null}
            />
            {newQty !== '' && !isNewQtyValid && (
              <p id={newQtyErrId} className="text-red-as-text text-xs">
                Enter a non-negative quantity with up to 3 decimal places.
              </p>
            )}
          </div>


          <div className="space-y-1">
            <label htmlFor={reasonId} className="font-data font-semibold text-xs uppercase tracking-widest text-text-secondary">
              Reason
            </label>
            <textarea
              id={reasonId}
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              rows={3}
              maxLength={MAX_REASON}
              aria-describedby={reasonHintId}
              className="w-full rounded-md border border-border-strong bg-bg-input p-2 text-sm text-text-primary focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-gold placeholder:text-text-muted"
              placeholder="At least 3 characters; appears in the audit trail."
            />
            <p id={reasonHintId} className="text-text-secondary text-xs">
              {reason.trim().length}/{MAX_REASON}
            </p>
          </div>

          {/* Le registre est append-only : l'ajustement n'écrase pas le stock,
              il émet un mouvement d'écart. Le dire avant le bouton, pas après. */}
          <p className="rounded-md border border-border-subtle bg-surface-inert p-2 text-xs text-text-secondary">
            Your declaration is recorded in your name. Stock changes only after independent owner approval.
          </p>

          </fieldset>
          <div className="flex justify-end gap-2 pt-2">
            <Button type="button" variant="ghost" onClick={handleClose} disabled={attemptLocked || adjustMut.isPending}>Cancel</Button>
            <Button type="submit" variant="ink" disabled={!canSubmit}>
              {adjustMut.isPending ? 'Submitting…' : attemptLocked ? 'Retry declaration' : 'Submit for approval'}
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}
