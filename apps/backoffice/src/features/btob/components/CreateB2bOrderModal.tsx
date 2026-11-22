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
//
// Prix de ligne : create_b2b_order résout le prix serveur (négocié > catégorie
// > retail) et ignore celui qu'on envoie. Le prix n'est donc plus saisi : il
// est lu au même résolveur par useB2bLinePrices et affiché en lecture seule (audit
// Sales 2026-11-21 — le champ éditable faisait mentir le total, et son
// préremplissage sautait le prix de catégorie).

import { useEffect, useId, useMemo, useRef, useState, type FormEvent, type JSX } from 'react';
import { Trash2, Plus } from 'lucide-react';
import { toast } from 'sonner';
import { Dialog, DialogDescription, Input, Select } from '@breakery/ui';
import { Button, DialogContent, DialogTitle } from '@/components/BackofficeUi.js';
import { formatCurrency } from '@breakery/utils';
import {
  useCreateB2bOrder,
  CreateB2bOrderError,
  type CreditLimitExceededPayload,
} from '../hooks/useCreateB2bOrder.js';
import { useB2bCustomers } from '../hooks/useB2bCustomers.js';
import { useProductsForB2bOrder } from '../hooks/useProductsForB2bOrder.js';
import { checkB2bStockAvailability, useB2bStockAvailability } from '../hooks/useB2bStockAvailability.js';
import { useB2bLinePrices } from '../hooks/useB2bLinePrices.js';
import { FOCUS_RING } from '@/components/focusRing.js';

// Pas de prix dans la ligne : il n'est plus saisi, il est lu au serveur
// (`useB2bLinePrices`). Un champ éditable que la RPC ignorait faisait mentir
// le total affiché.
interface ItemRow {
  rowKey:     string;
  productId:  string;
  quantity:   string;       // string for input control
}

function newRow(): ItemRow {
  return {
    rowKey:     crypto.randomUUID(),
    productId:  '',
    quantity:   '',
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
  const submitting = useRef(false);

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

  const prices = useB2bLinePrices(customerId, items.map((r) => r.productId));

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
    updateRow(rowKey, { productId });
  }

  const priceOf = (productId: string): number | undefined => prices.data?.get(productId);
  const pricesReady = items.every((r) => r.productId === '' || priceOf(r.productId) !== undefined);

  const itemsTotal = useMemo(() => {
    let sum = 0;
    for (const r of items) {
      const q = Number.parseFloat(r.quantity);
      const p = prices.data?.get(r.productId);
      if (Number.isFinite(q) && q > 0 && p !== undefined) sum += q * p;
    }
    return sum;
  }, [items, prices.data]);

  const itemsValid = items.every((r) => {
    if (r.productId === '') return false;
    const q = Number.parseFloat(r.quantity);
    return Number.isFinite(q) && q > 0;
  });

  const availability = useB2bStockAvailability(items.map((item) => ({
    product_id: item.productId, quantity: Number.parseFloat(item.quantity),
  })), open && itemsValid);

  const canSubmit = customerId !== '' && items.length > 0 && itemsValid && pricesReady && !createMut.isPending;

  function handleClose(): void {
    setFormError(null);
    setCreditPayload(null);
    onClose();
  }

  async function handleSubmit(e: FormEvent): Promise<void> {
    e.preventDefault();
    if (!canSubmit || submitting.current) return;
    submitting.current = true;
    setFormError(null);
    setCreditPayload(null);

    const payload = {
      customerId,
      items: items.map((r) => ({
        product_id: r.productId,
        quantity:   Number.parseFloat(r.quantity),
        // Ignoré par la RPC, qui re-résout ; envoyé pour le contrat du payload.
        unit_price: priceOf(r.productId) ?? 0,
      })),
      ...(notes.trim()        !== '' ? { notes:        notes.trim() }        : {}),
      ...(deliveryDate.trim() !== '' ? { deliveryDate: deliveryDate.trim() } : {}),
      idempotencyKey,
    };

    // Une vérification neuve porte sur le panier de CET envoi, jamais sur la
    // query d'un formulaire modifié ensuite. Sa fin ne retarde pas la création.
    const stockCheck = checkB2bStockAvailability(payload.items);
    try {
      await createMut.mutateAsync(payload);
      handleClose();
      // Le toast global reste visible après le démontage du dialogue.
      void stockCheck.then((available) => {
        if (available === false) {
          toast.warning('B2B order created. Stock is currently insufficient. Replenish stock before confirming pickup.', { duration: 20000, closeButton: true });
        } else if (available === null) {
          toast.warning('B2B order created. Stock availability was not verified. Stock must be checked again at pickup.', { duration: 20000, closeButton: true });
        }
      }).catch(() => undefined);
    } catch (err) {
      if (err instanceof CreateB2bOrderError) {
        if (err.code === 'credit_limit_exceeded' && err.payload !== undefined) {
          setCreditPayload(err.payload);
          setFormError(null);
          return;
        }
        switch (err.code) {
          case 'customer_not_b2b':
            setFormError('Selected customer is not a B2B account.');
            break;
          case 'permission_denied':
            setFormError('You do not have permission to create B2B orders.');
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
    } finally {
      submitting.current = false;
    }
  }

  return (
    <Dialog open={open} onOpenChange={(o) => { if (!o) handleClose(); }}>
      <DialogContent className="max-w-2xl">
        <DialogTitle>New B2B order</DialogTitle>
        <DialogDescription className="sr-only">
          Create a B2B order on credit. The customer balance will be increased by the total
          and the order will sit in b2b_pending state until a payment is recorded.
        </DialogDescription>

        <form onSubmit={(e) => { void handleSubmit(e); }} noValidate className="space-y-4">
          {formError !== null && (
            <div role="alert" className="rounded-md border border-red bg-red-soft p-2 text-xs text-red-as-text">
              {formError}
            </div>
          )}
          {creditPayload !== null && (
            <div role="alert" className="rounded-md border border-warning bg-warning-soft p-3 text-xs text-warning">
              <div className="font-semibold">Credit limit exceeded</div>
              <div className="mt-1 space-y-0.5">
                <div>Current balance:  <span className="font-mono">{formatCurrency(creditPayload.current_balance)}</span></div>
                <div>Credit limit:     <span className="font-mono">{creditPayload.credit_limit !== null ? formatCurrency(creditPayload.credit_limit) : '—'}</span></div>
                <div>Available credit: <span className="font-mono">{creditPayload.available !== null ? formatCurrency(creditPayload.available) : '—'}</span></div>
                <div>Order total:      <span className="font-mono">{formatCurrency(itemsTotal)}</span></div>
                <div>Would exceed by:  <span className="font-mono">{creditPayload.would_exceed_by !== null ? formatCurrency(creditPayload.would_exceed_by) : '—'}</span></div>
              </div>
              <div className="mt-2">Adjust the basket or escalate to a manager to increase the credit limit.</div>
            </div>
          )}

          <div className="space-y-1">
            <label htmlFor={customerSelId} className="font-data font-semibold text-xs uppercase tracking-widest text-text-secondary">
              Customer
            </label>
            <Select
              id={customerSelId}
              value={customerId}
              onChange={(e) => { setCustomerId(e.target.value); }}
              disabled={customers.isLoading}
            >
              <option value="">— Select a B2B customer —</option>
              {customers.data?.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.b2b_company_name ?? c.name}
                </option>
              ))}
            </Select>
            {selectedCustomer !== null && (
              <p className="text-xs text-text-muted">
                Outstanding: <span className="font-mono">{formatCurrency(selectedCustomer.b2b_current_balance)}</span>
                {selectedCustomer.b2b_credit_limit !== null && (
                  <> • Limit: <span className="font-mono">{formatCurrency(selectedCustomer.b2b_credit_limit)}</span></>
                )}
              </p>
            )}
          </div>

          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <span className="font-data font-semibold text-xs uppercase tracking-widest text-text-secondary">Items</span>
              <Button type="button" variant="ghost" size="sm" onClick={addRow}>
                <Plus className="h-3.5 w-3.5" aria-hidden /> Add line
              </Button>
            </div>
            <p className="text-xs text-text-muted">
              Prices come from the server: negotiated price, then customer category, then retail. They cannot be edited here.
            </p>
            {prices.isError && (
              <p role="alert" className="text-xs text-red-as-text">
                Prices could not be loaded — the order cannot be created until they are.{' '}
                <button type="button" className={`rounded-sm underline ${FOCUS_RING}`} onClick={() => { void prices.refetch(); }}>
                  Try again
                </button>
              </p>
            )}
            <div className="space-y-2">
              {items.map((row, idx) => {
                return (
                  <div key={row.rowKey} className="grid grid-cols-12 gap-2 items-start">
                    <Select
                      aria-label={`Product for line ${idx + 1}`}
                      value={row.productId}
                      onChange={(e) => { handleProductChange(row.rowKey, e.target.value); }}
                      className="col-span-6"
                      disabled={products.isLoading}
                    >
                      <option value="">— Product —</option>
                      {products.data?.map((p) => (
                        <option key={p.id} value={p.id}>
                          {p.name} ({p.sku})
                        </option>
                      ))}
                    </Select>
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
                    />
                    {/* Lecture seule : le prix est celui que le serveur fixera. */}
                    <output
                      aria-label={`Unit price for line ${idx + 1}`}
                      className="col-span-3 flex h-full items-center justify-end whitespace-nowrap pr-2 font-data text-sm tabular-nums text-text-primary"
                    >
                      {row.productId === '' || customerId === ''
                        ? '—'
                        : priceOf(row.productId) !== undefined
                          ? formatCurrency(priceOf(row.productId) ?? 0)
                          : prices.isError ? '—' : '…'}
                    </output>
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
                  </div>
                );
              })}
            </div>
          </div>

          <p className="text-sm text-text-muted">Stock is not reserved. General stock is checked and deducted when pickup is confirmed.</p>
          {itemsValid && availability.isFetching && <p role="status" className="text-sm text-text-muted">Checking stock availability…</p>}
          {itemsValid && !availability.isFetching && availability.data === false && (
            <p role="status" className="text-sm text-warning">There is not enough stock for this order right now. You can still create it. Stock must be sufficient when pickup is confirmed.</p>
          )}
          {itemsValid && availability.isError && <p role="status" className="text-sm text-warning">Stock availability could not be checked. You can still create this order. Stock is checked again at pickup.</p>}

          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1">
              {/* « Pickup » et non « Delivery » : la marchandise est retirée au
                  magasin, il n'existe aucune tournée (décision produit actée —
                  docs/product/DESCRIPTION.md). Le payload RPC ne bouge pas. */}
              <label htmlFor={deliveryId} className="font-data font-semibold text-xs uppercase tracking-widest text-text-secondary">
                Pickup date
              </label>
              <Input
                id={deliveryId}
                type="date" lang="id-ID"
                value={deliveryDate}
                onChange={(e) => setDeliveryDate(e.target.value)}
              />
            </div>
            <div className="space-y-1 col-span-1">
              <label className="font-data font-semibold text-xs uppercase tracking-widest text-text-secondary">Total</label>
              <div className="h-9 flex items-center justify-end pr-2 font-mono text-base text-text-primary">
                {pricesReady && customerId !== '' ? formatCurrency(itemsTotal) : '—'}
              </div>
            </div>
          </div>

          <div className="space-y-1">
            <label htmlFor={notesId} className="font-data font-semibold text-xs uppercase tracking-widest text-text-secondary">
              Notes
            </label>
            <textarea
              id={notesId}
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              rows={2}
              className={`w-full rounded-md border border-border-strong bg-bg-input p-2 text-sm text-text-primary placeholder:text-text-muted ${FOCUS_RING}`}
              placeholder="Optional — PO reference, pickup instructions…"
            />
          </div>

          <div className="flex justify-end gap-2 pt-2">
            <Button type="button" variant="ghost" onClick={handleClose}>Cancel</Button>
            <Button type="submit" variant="ink" disabled={!canSubmit}>
              {createMut.isPending ? 'Creating…' : 'Create B2B order'}
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}
