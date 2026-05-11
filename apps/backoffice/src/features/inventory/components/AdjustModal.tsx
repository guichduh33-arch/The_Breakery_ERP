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

import { useEffect, useId, useMemo, useState, type FormEvent, type JSX } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { Button, Dialog, DialogContent, DialogTitle, DialogDescription, Input } from '@breakery/ui';
import { validateAdjust } from '@breakery/domain';
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
  return { id: row.product_id, sku: row.sku, name: row.name, current_stock: row.current_stock };
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
  const [idempotencyKey, setIdempotencyKey] = useState<string>(() => crypto.randomUUID());

  // Reset internal state every time we open the modal afresh.
  useEffect(() => {
    if (open) {
      setProduct(initialProduct !== undefined ? stockLevelToTypeaheadRow(initialProduct) : null);
      setNewQty('');
      setReason('');
      setFormError(null);
      setIdempotencyKey(crypto.randomUUID());
    }
  }, [open, initialProduct?.product_id]);

  const numericNewQty = Number.parseInt(newQty, 10);
  const isNewQtyValid = Number.isInteger(numericNewQty) && numericNewQty >= 0 && /^\d+$/.test(newQty);
  const isReasonValid = reason.trim().length >= 3 && reason.trim().length <= MAX_REASON;

  const delta = useMemo<number | null>(() => {
    if (!isNewQtyValid || product === null) return null;
    return numericNewQty - product.current_stock;
  }, [isNewQtyValid, numericNewQty, product]);

  const canSubmit = product !== null && isNewQtyValid && isReasonValid && !adjustMut.isPending;

  function handleClose(): void {
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
    try {
      await adjustMut.mutateAsync({
        productId:      product.id,
        newQty:         numericNewQty,
        reason:         reason.trim(),
        idempotencyKey,
      });
      handleClose();
    } catch (err) {
      if (err instanceof AdjustStockError) {
        switch (err.code) {
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
          Adjust stock {isLockedProduct && initialProduct !== undefined ? `— ${initialProduct.name}` : ''}
        </DialogTitle>
        <DialogDescription className="sr-only">
          Set the absolute on-hand quantity for this product. The delta is computed automatically.
        </DialogDescription>

        <form onSubmit={(e) => { void handleSubmit(e); }} noValidate className="space-y-4">
          {formError !== null && (
            <div role="alert" className="rounded-md border border-red bg-red/5 p-2 text-xs text-red">
              {formError}
            </div>
          )}

          {!isLockedProduct && (
            <div className="space-y-1">
              <label htmlFor={productInputId} className="text-xs uppercase tracking-widest text-text-secondary">
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

          {product !== null && (
            <div className="text-sm text-text-secondary">
              Current stock:{' '}
              <span className="text-text-primary font-mono">
                {product.current_stock.toLocaleString()}
              </span>{' '}
              <span className="text-text-muted">({product.sku})</span>
            </div>
          )}

          <div className="space-y-1">
            <label htmlFor={newQtyId} className="text-xs uppercase tracking-widest text-text-secondary">
              New on-hand quantity
            </label>
            <Input
              id={newQtyId}
              type="number"
              inputMode="numeric"
              min={0}
              step={1}
              value={newQty}
              onChange={(e) => setNewQty(e.target.value)}
              aria-invalid={newQty !== '' && !isNewQtyValid}
              aria-describedby={newQty !== '' && !isNewQtyValid ? newQtyErrId : undefined}
              disabled={product === null}
            />
            {newQty !== '' && !isNewQtyValid && (
              <p id={newQtyErrId} className="text-red text-xs">
                Enter a non-negative integer.
              </p>
            )}
          </div>

          {delta !== null && product !== null && (
            <div className="text-sm text-text-secondary">
              Preview:{' '}
              <span className="text-text-primary font-mono">
                {product.current_stock.toLocaleString()} → {numericNewQty.toLocaleString()}
              </span>{' '}
              <span className={delta === 0 ? 'text-text-muted' : delta > 0 ? 'text-green' : 'text-red'}>
                (Δ {delta > 0 ? '+' : ''}{delta})
              </span>
            </div>
          )}

          <div className="space-y-1">
            <label htmlFor={reasonId} className="text-xs uppercase tracking-widest text-text-secondary">
              Reason
            </label>
            <textarea
              id={reasonId}
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              rows={3}
              maxLength={MAX_REASON}
              aria-describedby={reasonHintId}
              className="w-full rounded-md border border-border-subtle bg-bg-input p-2 text-sm text-text-primary focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-gold"
              placeholder="At least 3 characters; appears in the audit trail."
            />
            <p id={reasonHintId} className="text-text-secondary text-[10px]">
              {reason.trim().length}/{MAX_REASON}
            </p>
          </div>

          <div className="flex justify-end gap-2 pt-2">
            <Button type="button" variant="ghost" onClick={handleClose}>Cancel</Button>
            <Button type="submit" variant="primary" disabled={!canSubmit}>
              {adjustMut.isPending ? 'Applying…' : 'Apply'}
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}
