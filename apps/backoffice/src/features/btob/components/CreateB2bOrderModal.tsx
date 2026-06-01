// apps/backoffice/src/features/btob/components/CreateB2bOrderModal.tsx
//
// Session 24 / Phase 2.A.3 — create a B2B order (credit-style, status=b2b_pending).
//
// Single-screen form (no wizard) — matches the established BO modal pattern
// (ReceiveModal, WasteModal, etc.). Pickers for customer + product use plain
// <select> elements ; the items table allows multiple rows.
//
// Surfaces credit_limit_exceeded errors with a payload alert showing
// would_exceed_by so the operator can either adjust the basket or escalate.

import { useEffect, useId, useMemo, useState, type FormEvent, type JSX } from 'react';
import { Trash2, Plus } from 'lucide-react';
import {
  Button,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogTitle,
  Input,
} from '@breakery/ui';
import { formatIdr } from '@breakery/utils';
import {
  useCreateB2bOrder,
  CreateB2bOrderError,
  type CreditLimitExceededPayload,
} from '../hooks/useCreateB2bOrder.js';
import { useB2bCustomers } from '../hooks/useB2bCustomers.js';
import { useProductsForB2bOrder } from '../hooks/useProductsForB2bOrder.js';

interface ItemRow {
  rowKey:     string;
  productId:  string;
  quantity:   string;       // string for input control
  unitPrice:  string;
}

function newRow(): ItemRow {
  return {
    rowKey:     crypto.randomUUID(),
    productId:  '',
    quantity:   '',
    unitPrice:  '',
  };
}

export interface CreateB2bOrderModalProps {
  open:    boolean;
  onClose: () => void;
}

export function CreateB2bOrderModal({ open, onClose }: CreateB2bOrderModalProps): JSX.Element {
  const createMut = useCreateB2bOrder();
  const customers = useB2bCustomers();
  const products  = useProductsForB2bOrder();

  const reactId       = useId();
  const customerSelId = `${reactId}-customer`;
  const notesId       = `${reactId}-notes`;
  const deliveryId    = `${reactId}-delivery`;

  const [customerId, setCustomerId]       = useState<string>('');
  const [items,      setItems]            = useState<ItemRow[]>(() => [newRow()]);
  const [notes,      setNotes]            = useState<string>('');
  const [deliveryDate, setDeliveryDate]   = useState<string>('');
  const [idempotencyKey, setIdempotencyKey] = useState<string>(() => crypto.randomUUID());
  const [formError, setFormError]         = useState<string | null>(null);
  const [creditPayload, setCreditPayload] = useState<CreditLimitExceededPayload | null>(null);

  useEffect(() => {
    if (open) {
      setCustomerId('');
      setItems([newRow()]);
      setNotes('');
      setDeliveryDate('');
      setIdempotencyKey(crypto.randomUUID());
      setFormError(null);
      setCreditPayload(null);
    }
  }, [open]);

  const selectedCustomer = useMemo(
    () => customers.data?.find((c) => c.id === customerId) ?? null,
    [customers.data, customerId],
  );

  const productById = useMemo(() => {
    const m = new Map<string, NonNullable<typeof products.data>[number]>();
    for (const p of products.data ?? []) m.set(p.id, p);
    return m;
  }, [products.data]);

  function updateRow(rowKey: string, patch: Partial<ItemRow>): void {
    setItems((prev) => prev.map((r) => (r.rowKey === rowKey ? { ...r, ...patch } : r)));
  }

  function addRow(): void {
    setItems((prev) => [...prev, newRow()]);
  }

  function removeRow(rowKey: string): void {
    setItems((prev) => (prev.length <= 1 ? prev : prev.filter((r) => r.rowKey !== rowKey)));
  }

  function handleProductChange(rowKey: string, productId: string): void {
    const product = productById.get(productId);
    updateRow(rowKey, {
      productId,
      unitPrice: product !== undefined ? String(product.price) : '',
    });
  }

  const itemsTotal = useMemo(() => {
    let sum = 0;
    for (const r of items) {
      const q = Number.parseFloat(r.quantity);
      const p = Number.parseFloat(r.unitPrice);
      if (Number.isFinite(q) && Number.isFinite(p) && q > 0 && p >= 0) sum += q * p;
    }
    return sum;
  }, [items]);

  const itemsValid = items.every((r) => {
    if (r.productId === '') return false;
    const q = Number.parseFloat(r.quantity);
    const p = Number.parseFloat(r.unitPrice);
    if (!Number.isFinite(q) || q <= 0) return false;
    if (!Number.isFinite(p) || p < 0)  return false;
    const product = productById.get(r.productId);
    if (product !== undefined && product.current_stock < q) return false;
    return true;
  });

  const canSubmit = customerId !== '' && items.length > 0 && itemsValid && !createMut.isPending;

  function handleClose(): void {
    setFormError(null);
    setCreditPayload(null);
    onClose();
  }

  async function handleSubmit(e: FormEvent): Promise<void> {
    e.preventDefault();
    if (!canSubmit) return;
    setFormError(null);
    setCreditPayload(null);

    const payload = {
      customerId,
      items: items.map((r) => ({
        product_id: r.productId,
        quantity:   Number.parseFloat(r.quantity),
        unit_price: Number.parseFloat(r.unitPrice),
      })),
      ...(notes.trim()        !== '' ? { notes:        notes.trim() }        : {}),
      ...(deliveryDate.trim() !== '' ? { deliveryDate: deliveryDate.trim() } : {}),
      idempotencyKey,
    };

    try {
      await createMut.mutateAsync(payload);
      handleClose();
    } catch (err) {
      if (err instanceof CreateB2bOrderError) {
        if (err.code === 'credit_limit_exceeded' && err.payload !== undefined) {
          setCreditPayload(err.payload);
          setFormError(null);
          return;
        }
        switch (err.code) {
          case 'insufficient_stock':
            setFormError('Insufficient stock for one of the products. Refresh and adjust quantities.');
            break;
          case 'customer_not_b2b':
            setFormError('Selected customer is not a B2B account.');
            break;
          case 'permission_denied':
            setFormError('You do not have permission to create B2B orders (needs pos.sale.create).');
            break;
          case 'fiscal_period_closed':
            setFormError('The current fiscal period is closed. Reopen it before creating B2B orders.');
            break;
          default:
            setFormError(err.message);
        }
      } else {
        setFormError('Something went wrong. Please retry.');
      }
    }
  }

  return (
    <Dialog open={open} onOpenChange={(o) => { if (!o) handleClose(); }}>
      <DialogContent className="max-w-2xl">
        <DialogTitle>New B2B Order</DialogTitle>
        <DialogDescription className="sr-only">
          Create a B2B order on credit. The customer balance will be increased by the total
          and the order will sit in b2b_pending state until a payment is recorded.
        </DialogDescription>

        <form onSubmit={(e) => { void handleSubmit(e); }} noValidate className="space-y-4">
          {formError !== null && (
            <div role="alert" className="rounded-md border border-red bg-red/5 p-2 text-xs text-red">
              {formError}
            </div>
          )}
          {creditPayload !== null && (
            <div role="alert" className="rounded-md border border-amber-500 bg-amber-500/10 p-3 text-xs text-amber-700">
              <div className="font-semibold">Credit limit exceeded</div>
              <div className="mt-1 space-y-0.5">
                <div>Current balance:  <span className="font-mono">{formatIdr(creditPayload.current_balance)}</span></div>
                <div>Credit limit:     <span className="font-mono">{creditPayload.credit_limit !== null ? formatIdr(creditPayload.credit_limit) : '—'}</span></div>
                <div>Available credit: <span className="font-mono">{creditPayload.available !== null ? formatIdr(creditPayload.available) : '—'}</span></div>
                <div>Order total:      <span className="font-mono">{formatIdr(itemsTotal)}</span></div>
                <div>Would exceed by:  <span className="font-mono">{creditPayload.would_exceed_by !== null ? formatIdr(creditPayload.would_exceed_by) : '—'}</span></div>
              </div>
              <div className="mt-2">Adjust the basket or escalate to a manager to increase the credit limit.</div>
            </div>
          )}

          <div className="space-y-1">
            <label htmlFor={customerSelId} className="text-xs uppercase tracking-widest text-text-secondary">
              Customer
            </label>
            <select
              id={customerSelId}
              value={customerId}
              onChange={(e) => setCustomerId(e.target.value)}
              className="h-9 w-full rounded-md border border-border-subtle bg-bg-input px-3 text-sm text-text-primary"
              disabled={customers.isLoading}
            >
              <option value="">— Select a B2B customer —</option>
              {customers.data?.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.b2b_company_name ?? c.name}
                </option>
              ))}
            </select>
            {selectedCustomer !== null && (
              <p className="text-[10px] text-text-muted">
                Outstanding: <span className="font-mono">{formatIdr(selectedCustomer.b2b_current_balance)}</span>
                {selectedCustomer.b2b_credit_limit !== null && (
                  <> • Limit: <span className="font-mono">{formatIdr(selectedCustomer.b2b_credit_limit)}</span></>
                )}
              </p>
            )}
          </div>

          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <span className="text-xs uppercase tracking-widest text-text-secondary">Items</span>
              <Button type="button" variant="ghost" size="sm" onClick={addRow}>
                <Plus className="h-3.5 w-3.5" aria-hidden /> Add line
              </Button>
            </div>
            <div className="space-y-2">
              {items.map((row, idx) => {
                const product   = row.productId !== '' ? productById.get(row.productId) ?? null : null;
                const q         = Number.parseFloat(row.quantity);
                const overstock = product !== null && Number.isFinite(q) && q > product.current_stock;
                return (
                  <div key={row.rowKey} className="grid grid-cols-12 gap-2 items-start">
                    <select
                      aria-label={`Product for line ${idx + 1}`}
                      value={row.productId}
                      onChange={(e) => handleProductChange(row.rowKey, e.target.value)}
                      className="col-span-6 h-9 rounded-md border border-border-subtle bg-bg-input px-2 text-sm text-text-primary"
                      disabled={products.isLoading}
                    >
                      <option value="">— Product —</option>
                      {products.data?.map((p) => (
                        <option key={p.id} value={p.id}>
                          {p.name} ({p.sku})
                        </option>
                      ))}
                    </select>
                    <Input
                      type="number"
                      inputMode="decimal"
                      min={0}
                      step="0.001"
                      placeholder="Qty"
                      aria-label={`Quantity for line ${idx + 1}`}
                      value={row.quantity}
                      onChange={(e) => updateRow(row.rowKey, { quantity: e.target.value })}
                      className="col-span-2"
                      aria-invalid={overstock}
                    />
                    <Input
                      type="number"
                      inputMode="decimal"
                      min={0}
                      step="0.01"
                      placeholder="Unit price"
                      aria-label={`Unit price for line ${idx + 1}`}
                      value={row.unitPrice}
                      onChange={(e) => updateRow(row.rowKey, { unitPrice: e.target.value })}
                      className="col-span-3"
                    />
                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      onClick={() => removeRow(row.rowKey)}
                      disabled={items.length <= 1}
                      aria-label={`Remove line ${idx + 1}`}
                      className="col-span-1"
                    >
                      <Trash2 className="h-3.5 w-3.5" aria-hidden />
                    </Button>
                    {overstock && product !== null && (
                      <p className="col-span-12 text-[10px] text-red">
                        Only {product.current_stock.toLocaleString()} in stock for {product.name}.
                      </p>
                    )}
                  </div>
                );
              })}
            </div>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1">
              <label htmlFor={deliveryId} className="text-xs uppercase tracking-widest text-text-secondary">
                Delivery date
              </label>
              <Input
                id={deliveryId}
                type="date"
                value={deliveryDate}
                onChange={(e) => setDeliveryDate(e.target.value)}
              />
            </div>
            <div className="space-y-1 col-span-1">
              <label className="text-xs uppercase tracking-widest text-text-secondary">Total</label>
              <div className="h-9 flex items-center justify-end pr-2 font-mono text-base text-text-primary">
                {formatIdr(itemsTotal)}
              </div>
            </div>
          </div>

          <div className="space-y-1">
            <label htmlFor={notesId} className="text-xs uppercase tracking-widest text-text-secondary">
              Notes
            </label>
            <textarea
              id={notesId}
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              rows={2}
              className="w-full rounded-md border border-border-subtle bg-bg-input p-2 text-sm text-text-primary"
              placeholder="Optional — PO reference, delivery instructions…"
            />
          </div>

          <div className="flex justify-end gap-2 pt-2">
            <Button type="button" variant="ghost" onClick={handleClose}>Cancel</Button>
            <Button type="submit" variant="primary" disabled={!canSubmit}>
              {createMut.isPending ? 'Creating…' : 'Create B2B order'}
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}
