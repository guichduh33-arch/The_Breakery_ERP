// apps/backoffice/src/features/inventory/components/WasteModal.tsx
//
// Records a shrinkage event. Product is pre-selected from the row that
// opened the modal, or selectable via typeahead when launched from the
// toolbar. Quantity is capped at the current on-hand because the server
// will refuse `insufficient_stock` anyway.

import { useEffect, useId, useState, type FormEvent, type JSX } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { Button, Dialog, DialogContent, DialogTitle, DialogDescription, Input } from '@breakery/ui';
import { validateWaste } from '@breakery/domain';
import { useWasteStock, WasteStockError } from '../hooks/useWasteStock.js';
import { STOCK_LEVELS_QUERY_KEY, type StockLevelRow } from '../hooks/useStockLevels.js';
import type { ProductTypeaheadRow } from '../hooks/useProductsForInventory.js';
import { ProductTypeahead } from './ProductTypeahead.js';

export interface WasteModalProps {
  open:             boolean;
  /** When provided, the typeahead is hidden and the product is locked. */
  initialProduct?:  StockLevelRow;
  onClose:          () => void;
}

type ReasonPreset = 'Expired' | 'Damaged' | 'Spoiled' | 'Other';

const PRESETS: readonly ReasonPreset[] = ['Expired', 'Damaged', 'Spoiled', 'Other'];
const MAX_REASON = 500;

function stockLevelToTypeaheadRow(row: StockLevelRow): ProductTypeaheadRow {
  return { id: row.product_id, sku: row.sku, name: row.name, current_stock: row.current_stock };
}

export function WasteModal({ open, initialProduct, onClose }: WasteModalProps): JSX.Element {
  const wasteMut = useWasteStock();
  const qc       = useQueryClient();
  const reactId  = useId();
  const productInputId = `${reactId}-product`;
  const qtyId    = `${reactId}-qty`;
  const qtyErrId = `${reactId}-qty-err`;
  const presetId = `${reactId}-preset`;
  const reasonId = `${reactId}-reason`;
  const reasonHintId = `${reactId}-reason-hint`;

  const [product, setProduct] = useState<ProductTypeaheadRow | null>(
    initialProduct !== undefined ? stockLevelToTypeaheadRow(initialProduct) : null,
  );
  const [qty, setQty] = useState<string>('');
  const [preset, setPreset] = useState<ReasonPreset>('Expired');
  const [otherReason, setOtherReason] = useState<string>('');
  const [formError, setFormError] = useState<string | null>(null);
  const [idempotencyKey, setIdempotencyKey] = useState<string>(() => crypto.randomUUID());

  useEffect(() => {
    if (open) {
      setProduct(initialProduct !== undefined ? stockLevelToTypeaheadRow(initialProduct) : null);
      setQty('');
      setPreset('Expired');
      setOtherReason('');
      setFormError(null);
      setIdempotencyKey(crypto.randomUUID());
    }
    // initialProduct object identity changes on every parent render; depending on the primitive product_id
    // is the real signal — adding initialProduct itself would reset the modal on unrelated parent updates.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, initialProduct?.product_id]);

  const numericQty = Number.parseFloat(qty);
  const isQtyPositive = Number.isFinite(numericQty) && numericQty > 0;
  const isQtyWithinStock = product !== null ? numericQty <= product.current_stock : false;
  const isQtyValid = isQtyPositive && isQtyWithinStock;

  const finalReason = preset === 'Other' ? otherReason.trim() : preset;
  const isReasonValid = finalReason.length >= 3 && finalReason.length <= MAX_REASON;

  const canSubmit = product !== null && isQtyValid && isReasonValid && !wasteMut.isPending;

  function handleClose(): void {
    setFormError(null);
    onClose();
  }

  async function handleSubmit(e: FormEvent): Promise<void> {
    e.preventDefault();
    if (!canSubmit || product === null) return;

    const v = validateWaste({
      productId:     product.id,
      quantity:      numericQty,
      reason:        finalReason,
      currentStock:  product.current_stock,
      idempotencyKey,
    });
    if (!v.ok) {
      setFormError(`Invalid input: ${v.error}.`);
      return;
    }

    setFormError(null);
    try {
      await wasteMut.mutateAsync({
        productId:      product.id,
        quantity:       numericQty,
        reason:         finalReason,
        idempotencyKey,
      });
      handleClose();
    } catch (err) {
      if (err instanceof WasteStockError) {
        switch (err.code) {
          case 'forbidden':
            setFormError('You no longer have permission to record waste. Please refresh.');
            break;
          case 'quantity_must_be_positive':
            setFormError('Quantity must be greater than zero.');
            break;
          case 'insufficient_stock':
            setFormError(`Only ${product.current_stock.toLocaleString()} in stock — stock changed elsewhere. Refresh and retry.`);
            void qc.invalidateQueries({ queryKey: STOCK_LEVELS_QUERY_KEY });
            break;
          case 'product_not_found':
            setFormError('Product was deleted in another session. Refresh and retry.');
            void qc.invalidateQueries({ queryKey: STOCK_LEVELS_QUERY_KEY });
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
          Record waste {isLockedProduct && initialProduct !== undefined ? `— ${initialProduct.name}` : ''}
        </DialogTitle>
        <DialogDescription className="sr-only">
          Decrement stock for shrinkage, expiry, or damage. The quantity is removed from on-hand.
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
                disabled={wasteMut.isPending}
              />
            </div>
          )}

          {product !== null && (
            <div className="text-sm text-text-secondary">
              Current stock:{' '}
              <span className="text-text-primary font-mono">
                {product.current_stock.toLocaleString()}
              </span>{' '}
              <span className="text-text-muted">(max: {product.current_stock.toLocaleString()})</span>
            </div>
          )}

          <div className="space-y-1">
            <label htmlFor={qtyId} className="text-xs uppercase tracking-widest text-text-secondary">
              Quantity wasted
            </label>
            <Input
              id={qtyId}
              type="number"
              inputMode="decimal"
              min={0}
              {...(product !== null ? { max: product.current_stock } : {})}
              step="0.001"
              value={qty}
              onChange={(e) => setQty(e.target.value)}
              aria-invalid={qty !== '' && !isQtyValid}
              aria-describedby={qty !== '' && !isQtyValid ? qtyErrId : undefined}
              disabled={product === null}
            />
            {qty !== '' && !isQtyPositive && (
              <p id={qtyErrId} className="text-red text-xs">Quantity must be &gt; 0.</p>
            )}
            {qty !== '' && isQtyPositive && product !== null && !isQtyWithinStock && (
              <p id={qtyErrId} className="text-red text-xs">
                Cannot exceed current stock ({product.current_stock.toLocaleString()}).
              </p>
            )}
          </div>

          <div className="space-y-1">
            <label htmlFor={presetId} className="text-xs uppercase tracking-widest text-text-secondary">
              Reason
            </label>
            <select
              id={presetId}
              value={preset}
              onChange={(e) => setPreset(e.target.value as ReasonPreset)}
              className="h-9 w-full rounded-md border border-border-subtle bg-bg-input px-3 text-sm text-text-primary"
            >
              {PRESETS.map((p) => (
                <option key={p} value={p}>{p}</option>
              ))}
            </select>
          </div>

          {preset === 'Other' && (
            <div className="space-y-1">
              <label htmlFor={reasonId} className="text-xs uppercase tracking-widest text-text-secondary">
                Describe
              </label>
              <textarea
                id={reasonId}
                value={otherReason}
                onChange={(e) => setOtherReason(e.target.value)}
                rows={3}
                maxLength={MAX_REASON}
                aria-describedby={reasonHintId}
                className="w-full rounded-md border border-border-subtle bg-bg-input p-2 text-sm text-text-primary focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-gold"
                placeholder="At least 3 characters; appears in the audit trail."
              />
              <p id={reasonHintId} className="text-text-secondary text-[10px]">
                {otherReason.trim().length}/{MAX_REASON}
              </p>
            </div>
          )}

          <div className="flex justify-end gap-2 pt-2">
            <Button type="button" variant="ghost" onClick={handleClose}>Cancel</Button>
            <Button type="submit" variant="primary" disabled={!canSubmit}>
              {wasteMut.isPending ? 'Recording…' : 'Record waste'}
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}
