// apps/backoffice/src/features/inventory/components/IncomingStockForm.tsx
//
// Inline form (NOT a modal) that records a free-form stock receipt via
// `record_incoming_stock_v1`. Mirrors ReceiveModal's field setup but:
//   - supplier is OPTIONAL (first option = "No supplier (free-form receipt)")
//   - lives on a standalone page, so it clears itself on success instead of
//     closing a Dialog
//
// Idempotency: a fresh UUID is generated per form mount and reused for
// retries; on a successful submit we rotate the key so the next submission
// gets its own.
//
// Spec ref: docs/superpowers/specs/2026-05-11-session-12-inventory-mvp-spec.md
//           Phase 2 — Incoming Stock UI

import { useEffect, useId, useRef, useState, type FormEvent, type JSX } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { Button, Input } from '@breakery/ui';
import { validateReceive } from '@breakery/domain';
import {
  useRecordIncomingStock,
  RecordIncomingStockError,
} from '../hooks/useRecordIncomingStock.js';
import { useInventoryReferenceData } from '../hooks/useInventoryReferenceData.js';
import { STOCK_LEVELS_QUERY_KEY } from '../hooks/useStockLevels.js';
import type { ProductTypeaheadRow } from '../hooks/useProductsForInventory.js';
import { ProductTypeahead } from './ProductTypeahead.js';

const MAX_REASON = 500;

export interface IncomingStockFormProps {
  onSuccess?: () => void;
}

export default function IncomingStockForm({ onSuccess }: IncomingStockFormProps): JSX.Element {
  const recordMut = useRecordIncomingStock();
  const refData   = useInventoryReferenceData();
  const qc        = useQueryClient();

  const reactId      = useId();
  const productId    = `${reactId}-product`;
  const supplierId   = `${reactId}-supplier`;
  const qtyId        = `${reactId}-qty`;
  const qtyErrId     = `${reactId}-qty-err`;
  const unitCostId   = `${reactId}-unit-cost`;
  const reasonId     = `${reactId}-reason`;

  const [product,  setProduct ] = useState<ProductTypeaheadRow | null>(null);
  const [supplier, setSupplier] = useState<string>('');
  const [qty,      setQty     ] = useState<string>('');
  const [unitCost, setUnitCost] = useState<string>('');
  const [reason,   setReason  ] = useState<string>('');
  const [formError, setFormError] = useState<string | null>(null);
  const [successMsg, setSuccessMsg] = useState<string | null>(null);
  const [idempotencyKey, setIdempotencyKey] = useState<string>(() => crypto.randomUUID());
  const successTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Clear pending success timer on unmount so we don't setState on an unmounted form.
  useEffect(() => () => {
    if (successTimerRef.current !== null) clearTimeout(successTimerRef.current);
  }, []);

  const numericQty = Number.parseFloat(qty);
  const isQtyValid = Number.isFinite(numericQty) && numericQty > 0;

  const numericUnitCost = unitCost === '' ? undefined : Number.parseFloat(unitCost);
  const isUnitCostValid =
    numericUnitCost === undefined ||
    (Number.isFinite(numericUnitCost) && numericUnitCost >= 0);

  const trimmedReason  = reason.trim();
  const reasonProvided = trimmedReason.length > 0;
  const isReasonValid  =
    !reasonProvided || (trimmedReason.length >= 3 && trimmedReason.length <= MAX_REASON);

  const canSubmit =
    product !== null &&
    isQtyValid &&
    isUnitCostValid &&
    isReasonValid &&
    !recordMut.isPending;

  function resetForm(): void {
    setProduct(null);
    setSupplier('');
    setQty('');
    setUnitCost('');
    setReason('');
    setFormError(null);
    setIdempotencyKey(crypto.randomUUID());
  }

  async function handleSubmit(e: FormEvent): Promise<void> {
    e.preventDefault();
    if (!canSubmit || product === null) return;

    // Re-use validateReceive — same shape, supplierId is required by the
    // domain validator. When the user picked no supplier we substitute a
    // placeholder UUID purely to pass that validator (the hook then omits
    // p_supplier_id from the RPC call so the server records a free-form receipt).
    const supplierIdForValidation = supplier !== '' ? supplier : '00000000-0000-0000-0000-000000000000';
    const v = validateReceive({
      productId:  product.id,
      quantity:   numericQty,
      supplierId: supplierIdForValidation,
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
      const productName = product.name;
      await recordMut.mutateAsync({
        productId:  product.id,
        quantity:   numericQty,
        ...(supplier !== '' ? { supplierId: supplier } : {}),
        ...(numericUnitCost !== undefined ? { unitCost: numericUnitCost } : {}),
        ...(trimmedReason !== '' ? { reason: trimmedReason } : {}),
        idempotencyKey,
      });
      resetForm();
      setSuccessMsg(`Receipt recorded for ${productName}.`);
      if (successTimerRef.current !== null) clearTimeout(successTimerRef.current);
      successTimerRef.current = setTimeout(() => setSuccessMsg(null), 3000);
      onSuccess?.();
    } catch (err) {
      if (err instanceof RecordIncomingStockError) {
        switch (err.code) {
          case 'forbidden':
            setFormError('You no longer have permission to record incoming stock. Please refresh.');
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
    <form
      onSubmit={(e) => { void handleSubmit(e); }}
      noValidate
      className="space-y-4 max-w-xl bg-bg-elevated border border-border-subtle rounded-lg p-6"
    >
      {formError !== null && (
        <div role="alert" className="rounded-md border border-red bg-red/5 p-2 text-xs text-red">
          {formError}
        </div>
      )}
      {successMsg !== null && (
        <div role="status" className="rounded-md border border-emerald-500/40 bg-emerald-500/5 p-2 text-xs text-emerald-500">
          {successMsg}
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
          disabled={recordMut.isPending}
        />
        {product !== null && (
          <p className="text-text-muted text-[10px]">
            Current stock: <span className="font-mono">{product.current_stock.toLocaleString()}</span>
          </p>
        )}
      </div>

      <div className="space-y-1">
        <label htmlFor={supplierId} className="text-xs uppercase tracking-widest text-text-secondary">
          Supplier <span className="normal-case text-text-muted">(optional)</span>
        </label>
        <select
          id={supplierId}
          value={supplier}
          onChange={(e) => setSupplier(e.target.value)}
          className="h-9 w-full rounded-md border border-border-subtle bg-bg-input px-3 text-sm text-text-primary"
          disabled={refData.isLoading || recordMut.isPending}
        >
          <option value="">No supplier (free-form receipt)</option>
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
            min={0.001}
            step="0.001"
            value={qty}
            onChange={(e) => setQty(e.target.value)}
            disabled={recordMut.isPending}
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
            disabled={recordMut.isPending}
            aria-invalid={unitCost !== '' && !isUnitCostValid}
          />
        </div>
      </div>

      <div className="space-y-1">
        <label htmlFor={reasonId} className="text-xs uppercase tracking-widest text-text-secondary">
          Reason / reference
        </label>
        <Input
          id={reasonId}
          type="text"
          value={reason}
          onChange={(e) => setReason(e.target.value)}
          maxLength={MAX_REASON}
          placeholder="Stock receipt"
          disabled={recordMut.isPending}
        />
      </div>

      <div className="flex justify-end gap-2 pt-2">
        <Button type="submit" variant="primary" disabled={!canSubmit}>
          {recordMut.isPending ? 'Recording…' : 'Record receipt'}
        </Button>
      </div>
    </form>
  );
}
