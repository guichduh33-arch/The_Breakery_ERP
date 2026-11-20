// apps/backoffice/src/features/purchasing/components/POFormDraft.tsx
//
// Session 13 — Phase 3.A — Pure presentational form for creating a PO draft.
// Decouples display from data fetching so the smoke test can render it with
// supplier + product props (no QueryClient needed).
//
// Validation rules:
//   - At least 1 line item.
//   - supplier_id required.
//   - Each line: product, qty > 0, unit_cost >= 0, 0 <= discount <= line value.
//   - S3-06 : escompte global <= sous-total, port >= 0. Totaux et ventilation
//     via computePurchaseOrderTotals (miroir de la ventilation serveur).

import { useId, useMemo, type JSX } from 'react';
import { Button } from '@/components/BackofficeUi.js';
import { formatCurrency } from '@breakery/utils';
import { computePurchaseOrderTotals } from '@breakery/domain';
import type { CreatePOItemArgs } from '../hooks/useCreatePurchaseOrder.js';
import type { PoUnitOption } from '../hooks/useAllProductsForPO.js';
import { FOCUS_RING } from '@/components/focusRing.js';

const NOTES_MAX = 500;

export interface SupplierOption {
  id:   string;
  code: string;
  name: string;
}

export interface ProductOption {
  id:        string;
  sku:       string;
  name:      string;
  unit:      string;
  cost_price?: number | null;
  // Session 46 — R2: valid purchase units for this product (base ∪ alternatives)
  // + the default purchase unit. When absent, the unit cell falls back to the
  // base unit only.
  unitOptions?:         PoUnitOption[];
  defaultPurchaseUnit?: string;
}

export interface POFormDraftValue {
  supplierId:     string;
  expectedDate:   string;
  orderDate:      string;
  paymentTerms:   'cash' | 'credit';
  vatRate:        number;     // 0..1
  discountAmount: number;     // S3-06 — escompte global, en montant
  deliveryFee:    number;     // S3-06 — port facturé, sans PPN ajoutée
  notes:          string;
  items:          POFormDraftItem[];
}

export interface POFormDraftItem {
  productId:         string;
  quantity:          number;
  unit:              string;
  unitFactorToBase:  number;   // base-unit conversion factor (default 1)
  unitCost:          number;
  discountAmount:    number;   // S3-06 — escompte de ligne, en montant
  notes:             string;
}

export interface POFormDraftProps {
  /** Le rail est réservé à la page ; l'édition en dialogue reste empilée. */
  layout?: 'stacked' | 'document';
  value:        POFormDraftValue;
  onChange:     (next: POFormDraftValue) => void;
  suppliers:    SupplierOption[];
  products:     ProductOption[];
  onSubmit?:    () => void;
  submitting?:  boolean;
  error?:       string;
  submitLabel?: string;   // Session 46 — B4 reuses the form in edit mode
}

export function newEmptyItem(): POFormDraftItem {
  return { productId: '', quantity: 0, unit: '', unitFactorToBase: 1, unitCost: 0, discountAmount: 0, notes: '' };
}

/** Resolve the base-unit factor for a chosen unit code on a given product. */
function factorForUnit(prod: ProductOption | undefined, unit: string): number {
  if (prod?.unitOptions === undefined) return 1;
  return prod.unitOptions.find((o) => o.code === unit)?.factor ?? 1;
}

export function emptyPOFormDraftValue(): POFormDraftValue {
  return {
    supplierId:   '',
    expectedDate: '',
    orderDate:    '',
    paymentTerms: 'credit',
    vatRate:      0.11,
    discountAmount: 0,
    deliveryFee:  0,
    notes:        '',
    items:        [newEmptyItem()],
  };
}

export function validatePOFormDraft(v: POFormDraftValue): string | undefined {
  if (v.supplierId === '') return 'Supplier required';
  if (v.items.length === 0) return 'At least one line required';
  for (const [i, it] of v.items.entries()) {
    if (it.productId === '')   return `Line ${i + 1}: product required`;
    if (!Number.isFinite(it.quantity) || it.quantity <= 0)
      return `Line ${i + 1}: quantity must be > 0`;
    if (!Number.isFinite(it.unitCost) || it.unitCost < 0)
      return `Line ${i + 1}: unit cost must be >= 0`;
    if (!Number.isFinite(it.discountAmount) || it.discountAmount < 0
        || it.discountAmount > it.quantity * it.unitCost)
      return `Line ${i + 1}: discount must be between 0 and the line value`;
  }
  if (v.vatRate < 0 || v.vatRate > 1) return 'VAT rate must be between 0 and 1';
  const net = v.items.reduce((a, it) => a + it.quantity * it.unitCost - it.discountAmount, 0);
  if (!Number.isFinite(v.discountAmount) || v.discountAmount < 0 || v.discountAmount > net)
    return 'Order discount must be between 0 and the subtotal';
  if (!Number.isFinite(v.deliveryFee) || v.deliveryFee < 0) return 'Delivery fee must be >= 0';
  return undefined;
}

export function toCreatePOItems(v: POFormDraftValue): CreatePOItemArgs[] {
  return v.items.map((it) => {
    const base: CreatePOItemArgs = {
      productId:        it.productId,
      quantity:         it.quantity,
      unitFactorToBase: it.unitFactorToBase,
      unitCost:         it.unitCost,
    };
    const unit = it.unit.trim();
    if (unit !== '') base.unit = unit;
    const notes = it.notes.trim();
    if (notes !== '') base.notes = notes;
    if (it.discountAmount > 0) base.discountAmount = it.discountAmount;
    return base;
  });
}

export function POFormDraft({
  value, onChange, suppliers, products,
  onSubmit, submitting = false, error,
  submitLabel = 'Create purchase order',
  layout = 'stacked',
}: POFormDraftProps): JSX.Element {
  const reactId = useId();
  const totals = useMemo(() => computePurchaseOrderTotals({
    lines: value.items.map((it) => ({
      quantity: it.quantity, unitCost: it.unitCost, discountAmount: it.discountAmount,
    })),
    discountAmount: value.discountAmount,
    deliveryFee:    value.deliveryFee,
    vatRate:        value.vatRate,
  }), [value.items, value.discountAmount, value.deliveryFee, value.vatRate]);
  const summaryRows: { label: string; amount: number }[] = [
    { label: 'Subtotal', amount: totals.subtotal },
    ...(totals.discountAmount > 0 ? [{ label: 'Order discount', amount: -totals.discountAmount }] : []),
    { label: 'VAT', amount: totals.vatAmount },
    ...(totals.deliveryFee > 0 ? [{ label: 'Delivery fee', amount: totals.deliveryFee }] : []),
  ];

  function patch(p: Partial<POFormDraftValue>): void {
    onChange({ ...value, ...p });
  }

  function patchItem(idx: number, p: Partial<POFormDraftItem>): void {
    const next = value.items.slice();
    const merged = { ...next[idx], ...p } as POFormDraftItem;
    // Product just selected → default unit (purchase unit), factor + unit cost.
    if (p.productId !== undefined) {
      const prod = products.find((x) => x.id === p.productId);
      if (prod !== undefined) {
        const defUnit = prod.defaultPurchaseUnit ?? prod.unit;
        merged.unit             = defUnit;
        merged.unitFactorToBase = factorForUnit(prod, defUnit);
        if (merged.unitCost === 0 && (prod.cost_price ?? 0) > 0)
          merged.unitCost = Number(prod.cost_price);
      }
    }
    // Unit changed via the constrained select → recompute the base-unit factor.
    if (p.unit !== undefined) {
      const prod = products.find((x) => x.id === merged.productId);
      merged.unitFactorToBase = factorForUnit(prod, p.unit);
    }
    next[idx] = merged;
    patch({ items: next });
  }

  function addItem(): void {
    patch({ items: [...value.items, newEmptyItem()] });
  }

  function removeItem(idx: number): void {
    if (value.items.length === 1) return; // keep at least one
    patch({ items: value.items.filter((_, i) => i !== idx) });
  }

  return (
    <form
      data-testid="po-form-draft"
      onSubmit={(e) => { e.preventDefault(); onSubmit?.(); }}
      className="space-y-4"
    >
      <div className={layout === 'document' ? 'grid items-start gap-5 xl:grid-cols-[minmax(0,1fr)_18rem]' : ''}>
      <div className="min-w-0 space-y-5 rounded-md border border-border-subtle bg-bg-elevated p-5">
      <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
        <div className="space-y-1 md:col-span-2">
          <label htmlFor={`${reactId}-supplier`} className="font-data font-semibold text-xs uppercase tracking-widest text-text-secondary">
            Supplier
          </label>
          <select
            id={`${reactId}-supplier`}
            value={value.supplierId}
            onChange={(e) => patch({ supplierId: e.target.value })}
            disabled={submitting}
            className={`h-9 w-full rounded-md border border-border-strong bg-bg-input px-3 text-sm text-text-primary ${FOCUS_RING}`}
          >
            <option value="">— Select supplier —</option>
            {suppliers.map((s) => (
              <option key={s.id} value={s.id}>{s.name} ({s.code})</option>
            ))}
          </select>
        </div>

        <div className="space-y-1">
          <label htmlFor={`${reactId}-payment`} className="font-data font-semibold text-xs uppercase tracking-widest text-text-secondary">
            Payment terms
          </label>
          <select
            id={`${reactId}-payment`}
            value={value.paymentTerms}
            onChange={(e) => patch({ paymentTerms: e.target.value as 'cash' | 'credit' })}
            disabled={submitting}
            className={`h-9 w-full rounded-md border border-border-strong bg-bg-input px-3 text-sm text-text-primary ${FOCUS_RING}`}
          >
            <option value="credit">Credit</option>
            <option value="cash">Cash</option>
          </select>
        </div>

        <div className="space-y-1">
          <label htmlFor={`${reactId}-order`} className="font-data font-semibold text-xs uppercase tracking-widest text-text-secondary">
            Order date
          </label>
          <input
            id={`${reactId}-order`}
            type="date" lang="id-ID"
            value={value.orderDate}
            onChange={(e) => patch({ orderDate: e.target.value })}
            disabled={submitting}
            className={`h-9 w-full rounded-md border border-border-strong bg-bg-input px-3 text-sm text-text-primary ${FOCUS_RING}`}
          />
        </div>

        <div className="space-y-1">
          <label htmlFor={`${reactId}-expected`} className="font-data font-semibold text-xs uppercase tracking-widest text-text-secondary">
            Expected
          </label>
          <input
            id={`${reactId}-expected`}
            type="date" lang="id-ID"
            value={value.expectedDate}
            onChange={(e) => patch({ expectedDate: e.target.value })}
            disabled={submitting}
            className={`h-9 w-full rounded-md border border-border-strong bg-bg-input px-3 text-sm text-text-primary ${FOCUS_RING}`}
          />
        </div>

        <div className="space-y-1">
          <label htmlFor={`${reactId}-vat`} className="font-data font-semibold text-xs uppercase tracking-widest text-text-secondary">
            VAT rate
          </label>
          <input
            id={`${reactId}-vat`}
            type="number"
            min={0}
            max={1}
            step={0.01}
            value={value.vatRate}
            onChange={(e) => patch({ vatRate: Number(e.target.value) || 0 })}
            disabled={submitting}
            className={`h-9 w-full rounded-md border border-border-strong bg-bg-input px-3 text-sm text-text-primary ${FOCUS_RING}`}
          />
        </div>

        {([
          ['discountAmount', 'Order discount'],
          ['deliveryFee', 'Delivery fee'],
        ] as const).map(([key, label]) => (
          <div key={key} className="space-y-1">
            <label htmlFor={`${reactId}-${key}`} className="font-data font-semibold text-xs uppercase tracking-widest text-text-secondary">
              {label}
            </label>
            <input
              id={`${reactId}-${key}`}
              type="number" min={0} step={1}
              value={value[key]}
              onChange={(e) => {
                const n = Math.max(0, Number(e.target.value) || 0);
                patch(key === 'discountAmount' ? { discountAmount: n } : { deliveryFee: n });
              }}
              disabled={submitting}
              className={`h-9 w-full text-right rounded-md border border-border-strong bg-bg-input px-3 text-sm text-text-primary ${FOCUS_RING}`}
            />
          </div>
        ))}
      </div>
      {value.deliveryFee > 0 && (
        <p className="text-xs text-text-muted">
          The delivery fee is spread across the lines by value and added to their stock cost.
        </p>
      )}

      <div className="space-y-2">
        <div className="flex items-center justify-between">
          <h3 id="po-draft-line-items-heading" className="text-sm font-semibold text-text-primary">Line items</h3>
          <Button type="button" variant="secondary" size="sm" onClick={addItem} disabled={submitting}>
            + Add line
          </Button>
        </div>
        <div className="overflow-x-auto border border-border-subtle rounded-md">
          <table className="w-full text-sm" data-testid="po-form-items" aria-labelledby="po-draft-line-items-heading">
            <thead className="bg-bg-overlay text-text-secondary text-xs uppercase tracking-widest">
              <tr>
                <th scope="col" className="text-left px-3 py-2">Product</th>
                <th scope="col" className="text-right px-3 py-2 w-24">Qty</th>
                <th scope="col" className="text-left px-3 py-2 w-20">Unit</th>
                <th scope="col" className="text-right px-3 py-2 w-32">Unit cost</th>
                <th scope="col" className="text-right px-3 py-2 w-28">Discount</th>
                <th scope="col" className="text-right px-3 py-2 w-32">Subtotal</th>
                <th scope="col" className="px-3 py-2 w-10"><span className="sr-only">Actions</span></th>
              </tr>
            </thead>
            <tbody>
              {value.items.map((it, idx) => (
                <tr key={idx} className="border-t border-border-subtle">
                  <td className="px-3 py-1.5">
                    <select
                      value={it.productId}
                      onChange={(e) => patchItem(idx, { productId: e.target.value })}
                      disabled={submitting}
                      aria-label={`Product for line ${idx + 1}`}
                      className={`h-9 w-full rounded-md border border-border-strong bg-bg-input px-2 text-sm ${FOCUS_RING}`}
                    >
                      <option value="">— Select —</option>
                      {products.map((p) => (
                        <option key={p.id} value={p.id}>{p.name} ({p.sku})</option>
                      ))}
                    </select>
                  </td>
                  <td className="px-3 py-1.5">
                    <input
                      type="number" min={0} step={0.001}
                      value={it.quantity}
                      onChange={(e) => patchItem(idx, { quantity: Number(e.target.value) || 0 })}
                      disabled={submitting}
                      aria-label={`Quantity for line ${idx + 1}`}
                      className={`h-9 w-full text-right rounded-md border border-border-strong bg-bg-input px-2 text-sm ${FOCUS_RING}`}
                    />
                  </td>
                  <td className="px-3 py-1.5">
                    {(() => {
                      const prod = products.find((x) => x.id === it.productId);
                      const opts = prod?.unitOptions;
                      if (opts === undefined || opts.length === 0) {
                        // No product selected yet, or product carries no unit metadata.
                        return (
                          <select
                            value={it.unit}
                            disabled
                            aria-label={`Unit for line ${idx + 1}`}
                            className={`h-9 w-full rounded-md border border-border-strong bg-bg-input px-2 text-sm disabled:opacity-50 ${FOCUS_RING}`}
                          >
                            <option value="">{it.unit || '—'}</option>
                          </select>
                        );
                      }
                      return (
                        <select
                          value={it.unit}
                          onChange={(e) => patchItem(idx, { unit: e.target.value })}
                          disabled={submitting}
                          aria-label={`Unit for line ${idx + 1}`}
                          className={`h-9 w-full rounded-md border border-border-strong bg-bg-input px-2 text-sm ${FOCUS_RING}`}
                        >
                          {opts.map((o) => (
                            <option key={o.code} value={o.code}>
                              {o.code}{o.factor !== 1 ? ` (×${o.factor})` : ''}
                            </option>
                          ))}
                        </select>
                      );
                    })()}
                  </td>
                  <td className="px-3 py-1.5">
                    <input
                      type="number" min={0} step={1}
                      value={it.unitCost}
                      onChange={(e) => patchItem(idx, { unitCost: Number(e.target.value) || 0 })}
                      disabled={submitting}
                      aria-label={`Unit cost for line ${idx + 1}`}
                      className={`h-9 w-full text-right rounded-md border border-border-strong bg-bg-input px-2 text-sm ${FOCUS_RING}`}
                    />
                  </td>
                  <td className="px-3 py-1.5">
                    <input
                      type="number" min={0} step={1}
                      value={it.discountAmount}
                      onChange={(e) => patchItem(idx, { discountAmount: Math.max(0, Number(e.target.value) || 0) })}
                      disabled={submitting}
                      aria-label={`Discount for line ${idx + 1}`}
                      className={`h-9 w-full text-right rounded-md border border-border-strong bg-bg-input px-2 text-sm ${FOCUS_RING}`}
                    />
                  </td>
                  <td className="px-3 py-1.5 text-right font-data tabular-nums text-text-primary">
                    {formatCurrency(totals.lines[idx]?.net ?? 0)}
                  </td>
                  <td className="px-3 py-1.5 text-center">
                    <button
                      type="button"
                      onClick={() => removeItem(idx)}
                      disabled={submitting || value.items.length === 1}
                      aria-label={`Remove line ${idx + 1}`}
                      className="text-text-secondary hover:text-danger disabled:opacity-30"
                    >
                      ×
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
            {layout === 'stacked' && <tfoot className="bg-bg-overlay text-sm">
              {summaryRows.map((r, i) => (
                <tr key={r.label} className={i === 0 ? 'border-t border-border-subtle' : undefined}>
                  <td colSpan={5} className="px-3 py-1.5 text-right text-text-secondary">{r.label}</td>
                  <td className="px-3 py-1.5 text-right font-data tabular-nums">{formatCurrency(r.amount)}</td>
                  <td />
                </tr>
              ))}
              <tr>
                <td colSpan={5} className="px-3 py-1.5 text-right font-semibold">Total</td>
                <td className="px-3 py-1.5 text-right font-data font-semibold tabular-nums">{formatCurrency(totals.total)}</td>
                <td />
              </tr>
            </tfoot>}
          </table>
        </div>
      </div>

      <div className="space-y-1">
        <label htmlFor={`${reactId}-notes`} className="font-data font-semibold text-xs uppercase tracking-widest text-text-secondary">
          Notes
        </label>
        <textarea
          id={`${reactId}-notes`}
          value={value.notes}
          onChange={(e) => patch({ notes: e.target.value.slice(0, NOTES_MAX) })}
          disabled={submitting}
          maxLength={NOTES_MAX}
          rows={2}
          className={`w-full rounded-md border border-border-strong bg-bg-input px-3 py-2 text-sm text-text-primary ${FOCUS_RING}`}
        />
        <div className="text-xs text-text-secondary text-right">{value.notes.length}/{NOTES_MAX}</div>
      </div>

      {error !== undefined && error !== '' && (
        <div role="alert" className="rounded-md border border-danger bg-danger-soft px-3 py-2 text-sm text-danger">
          {error}
        </div>
      )}
      </div>

      {layout === 'document' && (
        <aside aria-label="Purchase order summary" className="rounded-md border border-border-subtle bg-bg-elevated p-5 xl:sticky xl:top-0">
          <h2 className="text-lg font-medium tracking-tight">Order summary</h2>
          <p className="mt-1 text-xs text-text-muted">Calculated from the draft lines.</p>
          <dl className="mt-5 space-y-3 text-sm">
            {summaryRows.map((r) => (
              <div key={r.label} className="flex flex-wrap justify-between gap-2"><dt className="text-text-secondary">{r.label}</dt><dd className="font-data tabular-nums">{formatCurrency(r.amount)}</dd></div>
            ))}
            <div className="space-y-1 border-t border-border-subtle pt-3"><dt className="text-text-secondary">Total</dt><dd className="font-data text-xl font-medium tabular-nums">{formatCurrency(totals.total)}</dd></div>
          </dl>
          <p className="mt-5 border-t border-border-subtle pt-4 text-sm text-text-secondary">Goods are received later from the order detail.</p>
        </aside>
      )}
      </div>

      <div className="flex justify-end">
        <Button type="submit" size="sm" variant="ink" disabled={submitting}>
          {submitting ? 'Saving…' : submitLabel}
        </Button>
      </div>
    </form>
  );
}
