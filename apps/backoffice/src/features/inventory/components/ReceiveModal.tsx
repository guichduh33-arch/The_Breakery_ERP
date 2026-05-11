// apps/backoffice/src/features/inventory/components/ReceiveModal.tsx
//
// Records a positive movement from a supplier. Pre-selects the product
// passed via props (from the row dropdown) but allows the user to switch
// via the embedded typeahead. Unit cost + reason are optional.

import { useEffect, useId, useState, type FormEvent, type JSX } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { Button, Dialog, DialogContent, DialogTitle, DialogDescription, Input } from '@breakery/ui';
import { validateReceive } from '@breakery/domain';
import { useReceiveStock, ReceiveStockError } from '../hooks/useReceiveStock.js';
import { useInventoryReferenceData } from '../hooks/useInventoryReferenceData.js';
import { STOCK_LEVELS_QUERY_KEY, type StockLevelRow } from '../hooks/useStockLevels.js';
import type { ProductTypeaheadRow } from '../hooks/useProductsForInventory.js';
import { ProductTypeahead } from './ProductTypeahead.js';

export interface ReceiveModalProps {
  open:      boolean;
  /** Pre-fill the typeahead when the user opens from a specific row. */
  initialProduct?: StockLevelRow;
  onClose:   () => void;
}

const MAX_REASON = 500;

function stockLevelToTypeaheadRow(row: StockLevelRow): ProductTypeaheadRow {
  return { id: row.product_id, sku: row.sku, name: row.name, current_stock: row.current_stock };
}

export function ReceiveModal({ open, initialProduct, onClose }: ReceiveModalProps): JSX.Element {
  const receiveMut = useReceiveStock();
  const refData    = useInventoryReferenceData();
  const qc         = useQueryClient();
  const reactId      = useId();
  const productId    = `${reactId}-product`;
  const supplierId   = `${reactId}-supplier`;
  const qtyId        = `${reactId}-qty`;
  const qtyErrId     = `${reactId}-qty-err`;
  const unitCostId   = `${reactId}-unit-cost`;
  const reasonId     = `${reactId}-reason`;
  const reasonHintId = `${reactId}-reason-hint`;

  const [product,  setProduct ] = useState<ProductTypeaheadRow | null>(
    initialProduct !== undefined ? stockLevelToTypeaheadRow(initialProduct) : null,
  );
  const [supplier, setSupplier] = useState<string>('');
  const [qty,      setQty     ] = useState<string>('');
  const [unitCost, setUnitCost] = useState<string>('');
  const [reason,   setReason  ] = useState<string>('');
  const [formError, setFormError] = useState<string | null>(null);
  const [idempotencyKey, setIdempotencyKey] = useState<string>(() => crypto.randomUUID());

  // Reset every time we open with a (possibly new) initial product.
  useEffect(() => {
    if (open) {
      setProduct(initialProduct !== undefined ? stockLevelToTypeaheadRow(initialProduct) : null);
      setSupplier('');
      setQty('');
      setUnitCost('');
      setReason('');
      setFormError(null);
      setIdempotencyKey(crypto.randomUUID());
    }
  }, [open, initialProduct?.product_id]);

  const numericQty = Number.parseFloat(qty);
  const isQtyValid = Number.isFinite(numericQty) && numericQty > 0;

  const numericUnitCost = unitCost === '' ? undefined : Number.parseFloat(unitCost);
  const isUnitCostValid =
    numericUnitCost === undefined ||
    (Number.isFinite(numericUnitCost) && numericUnitCost >= 0);

  const reasonProvided = reason.trim().length > 0;
  const isReasonValid  = !reasonProvided || (reason.trim().length >= 3 && reason.trim().length <= MAX_REASON);

  const canSubmit =
    product !== null &&
    supplier !== '' &&
    isQtyValid &&
    isUnitCostValid &&
    isReasonValid &&
    !receiveMut.isPending;

  function handleClose(): void {
    setFormError(null);
    onClose();
  }

  async function handleSubmit(e: FormEvent): Promise<void> {
    e.preventDefault();
    if (!canSubmit || product === null) return;

    const trimmedReason = reason.trim();
    const v = validateReceive({
      productId:  product.id,
      quantity:   numericQty,
      supplierId: supplier,
      ...(numericUnitCost !== undefined ? { unitCost: numericUnitCost } : {}),
      ...(trimmedReason !== '' ? { reason: trimmedReason } : {}),
      idempotencyKey,
    });
    if (!v.ok) {
      setFormError(`Invalid input: ${v.error}.`);
      return;
    }

    setFormError(null);
    try {
      await receiveMut.mutateAsync({
        productId:  product.id,
        quantity:   numericQty,
        supplierId: supplier,
        ...(numericUnitCost !== undefined ? { unitCost: numericUnitCost } : {}),
        ...(trimmedReason !== '' ? { reason: trimmedReason } : {}),
        idempotencyKey,
      });
      handleClose();
    } catch (err) {
      if (err instanceof ReceiveStockError) {
        switch (err.code) {
          case 'forbidden':
            setFormError('You no longer have permission to receive stock. Please refresh.');
            break;
          case 'quantity_must_be_positive':
            setFormError('Quantity must be positive.');
            break;
          case 'supplier_not_found_or_inactive':
            setFormError('Supplier is inactive or was deleted. Reload the page.');
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

  return (
    <Dialog open={open} onOpenChange={(o) => { if (!o) handleClose(); }}>
      <DialogContent className="max-w-md">
        <DialogTitle>Receive stock</DialogTitle>
        <DialogDescription className="sr-only">
          Record an incoming shipment from a supplier. Quantity is added to current stock.
        </DialogDescription>

        <form onSubmit={handleSubmit} noValidate className="space-y-4">
          {formError !== null && (
            <div role="alert" className="rounded-md border border-red bg-red/5 p-2 text-xs text-red">
              {formError}
            </div>
          )}

          <div className="space-y-1">
            <label htmlFor={productId} className="text-xs uppercase tracking-widest text-text-secondary">
              Product
            </label>
            <ProductTypeahead
              id={productId}
              value={product}
              onChange={setProduct}
              disabled={receiveMut.isPending}
            />
            {product !== null && (
              <p className="text-text-muted text-[10px]">
                Current stock: <span className="font-mono">{product.current_stock.toLocaleString()}</span>
              </p>
            )}
          </div>

          <div className="space-y-1">
            <label htmlFor={supplierId} className="text-xs uppercase tracking-widest text-text-secondary">
              Supplier
            </label>
            <select
              id={supplierId}
              value={supplier}
              onChange={(e) => setSupplier(e.target.value)}
              className="h-9 w-full rounded-md border border-border-subtle bg-bg-input px-3 text-sm text-text-primary"
              disabled={refData.isLoading}
            >
              <option value="">— Select a supplier —</option>
              {refData.data?.suppliers.map((s) => (
                <option key={s.id} value={s.id}>{s.name} ({s.code})</option>
              ))}
            </select>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1">
              <label htmlFor={qtyId} className="text-xs uppercase tracking-widest text-text-secondary">
                Quantity received
              </label>
              <Input
                id={qtyId}
                type="number"
                inputMode="decimal"
                min={0}
                step="0.001"
                value={qty}
                onChange={(e) => setQty(e.target.value)}
                aria-invalid={qty !== '' && !isQtyValid}
                aria-describedby={qty !== '' && !isQtyValid ? qtyErrId : undefined}
              />
              {qty !== '' && !isQtyValid && (
                <p id={qtyErrId} className="text-red text-xs">Quantity must be &gt; 0.</p>
              )}
            </div>
            <div className="space-y-1">
              <label htmlFor={unitCostId} className="text-xs uppercase tracking-widest text-text-secondary">
                Unit cost
              </label>
              <Input
                id={unitCostId}
                type="number"
                inputMode="decimal"
                min={0}
                step="0.01"
                value={unitCost}
                onChange={(e) => setUnitCost(e.target.value)}
                placeholder="Optional"
                aria-invalid={unitCost !== '' && !isUnitCostValid}
              />
            </div>
          </div>

          <div className="space-y-1">
            <label htmlFor={reasonId} className="text-xs uppercase tracking-widest text-text-secondary">
              Reason / reference
            </label>
            <textarea
              id={reasonId}
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              rows={2}
              maxLength={MAX_REASON}
              aria-describedby={reasonHintId}
              className="w-full rounded-md border border-border-subtle bg-bg-input p-2 text-sm text-text-primary focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-gold"
              placeholder="Optional — e.g. PO-2026-04-21."
            />
            <p id={reasonHintId} className="text-text-secondary text-[10px]">
              {reason.trim().length}/{MAX_REASON}
            </p>
          </div>

          <div className="flex justify-end gap-2 pt-2">
            <Button type="button" variant="ghost" onClick={handleClose}>Cancel</Button>
            <Button type="submit" variant="primary" disabled={!canSubmit}>
              {receiveMut.isPending ? 'Receiving…' : 'Receive'}
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}
