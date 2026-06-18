// apps/backoffice/src/features/purchasing/components/POFormDraft.tsx
//
// Session 13 — Phase 3.A — Pure presentational form for creating a PO draft.
// Decouples display from data fetching so the smoke test can render it with
// supplier + product props (no QueryClient needed).
//
// Validation rules:
//   - At least 1 line item.
//   - supplier_id required.
//   - Each line: product, qty > 0, unit_cost >= 0.

import { useId, useMemo, type JSX } from 'react';
import { Button } from '@breakery/ui';
import type { CreatePOItemArgs } from '../hooks/useCreatePurchaseOrder.js';
import type { PoUnitOption } from '../hooks/useAllProductsForPO.js';

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
  notes:          string;
  items:          POFormDraftItem[];
}

export interface POFormDraftItem {
  productId:         string;
  quantity:          number;
  unit:              string;
  unitFactorToBase:  number;   // base-unit conversion factor (default 1)
  unitCost:          number;
  notes:             string;
}

export interface POFormDraftProps {
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
  return { productId: '', quantity: 0, unit: '', unitFactorToBase: 1, unitCost: 0, notes: '' };
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
  }
  if (v.vatRate < 0 || v.vatRate > 1) return 'VAT rate must be between 0 and 1';
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
    return base;
  });
}

export function POFormDraft({
  value, onChange, suppliers, products,
  onSubmit, submitting = false, error,
  submitLabel = 'Create purchase order',
}: POFormDraftProps): JSX.Element {
  const reactId = useId();
  const subtotal = useMemo(() =>
    value.items.reduce((acc, it) => acc + it.quantity * it.unitCost, 0)
  , [value.items]);
  const vatAmount = Math.round(subtotal * value.vatRate * 100) / 100;
  const total = subtotal + vatAmount;

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
      <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
        <div className="space-y-1 md:col-span-2">
          <label htmlFor={`${reactId}-supplier`} className="text-xs uppercase tracking-widest text-text-secondary">
            Supplier
          </label>
          <select
            id={`${reactId}-supplier`}
            value={value.supplierId}
            onChange={(e) => patch({ supplierId: e.target.value })}
            disabled={submitting}
            className="h-9 w-full rounded-md border border-border-subtle bg-bg-input px-3 text-sm text-text-primary"
          >
            <option value="">— Select supplier —</option>
            {suppliers.map((s) => (
              <option key={s.id} value={s.id}>{s.name} ({s.code})</option>
            ))}
          </select>
        </div>

        <div className="space-y-1">
          <label htmlFor={`${reactId}-payment`} className="text-xs uppercase tracking-widest text-text-secondary">
            Payment terms
          </label>
          <select
            id={`${reactId}-payment`}
            value={value.paymentTerms}
            onChange={(e) => patch({ paymentTerms: e.target.value as 'cash' | 'credit' })}
            disabled={submitting}
            className="h-9 w-full rounded-md border border-border-subtle bg-bg-input px-3 text-sm text-text-primary"
          >
            <option value="credit">Credit</option>
            <option value="cash">Cash</option>
          </select>
        </div>

        <div className="space-y-1">
          <label htmlFor={`${reactId}-order`} className="text-xs uppercase tracking-widest text-text-secondary">
            Order date
          </label>
          <input
            id={`${reactId}-order`}
            type="date"
            value={value.orderDate}
            onChange={(e) => patch({ orderDate: e.target.value })}
            disabled={submitting}
            className="h-9 w-full rounded-md border border-border-subtle bg-bg-input px-3 text-sm text-text-primary"
          />
        </div>

        <div className="space-y-1">
          <label htmlFor={`${reactId}-expected`} className="text-xs uppercase tracking-widest text-text-secondary">
            Expected
          </label>
          <input
            id={`${reactId}-expected`}
            type="date"
            value={value.expectedDate}
            onChange={(e) => patch({ expectedDate: e.target.value })}
            disabled={submitting}
            className="h-9 w-full rounded-md border border-border-subtle bg-bg-input px-3 text-sm text-text-primary"
          />
        </div>

        <div className="space-y-1">
          <label htmlFor={`${reactId}-vat`} className="text-xs uppercase tracking-widest text-text-secondary">
            VAT rate
          </label>
          <input
            id={`${reactId}-vat`}
            type="number"
            min={0}
            max={1}
            step={0.01}
            value={value.vatRate}
            onChange={(e) => patch({ vatRate: Number(e.target.value) })}
            disabled={submitting}
            className="h-9 w-full rounded-md border border-border-subtle bg-bg-input px-3 text-sm text-text-primary"
          />
        </div>
      </div>

      <div className="space-y-2">
        <div className="flex items-center justify-between">
          <h3 className="text-sm font-semibold text-text-primary">Line items</h3>
          <Button type="button" variant="secondary" size="sm" onClick={addItem} disabled={submitting}>
            + Add line
          </Button>
        </div>
        <div className="overflow-x-auto border border-border-subtle rounded-md">
          <table className="w-full text-sm" data-testid="po-form-items">
            <thead className="bg-bg-overlay text-text-secondary text-xs uppercase tracking-widest">
              <tr>
                <th className="text-left px-3 py-2">Product</th>
                <th className="text-right px-3 py-2 w-24">Qty</th>
                <th className="text-left px-3 py-2 w-20">Unit</th>
                <th className="text-right px-3 py-2 w-32">Unit cost</th>
                <th className="text-right px-3 py-2 w-32">Subtotal</th>
                <th className="px-3 py-2 w-10" aria-hidden />
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
                      className="h-8 w-full rounded-md border border-border-subtle bg-bg-input px-2 text-sm"
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
                      onChange={(e) => patchItem(idx, { quantity: Number(e.target.value) })}
                      disabled={submitting}
                      className="h-8 w-full text-right rounded-md border border-border-subtle bg-bg-input px-2 text-sm"
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
                            className="h-8 w-full rounded-md border border-border-subtle bg-bg-input px-2 text-sm disabled:opacity-50"
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
                          className="h-8 w-full rounded-md border border-border-subtle bg-bg-input px-2 text-sm"
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
                      onChange={(e) => patchItem(idx, { unitCost: Number(e.target.value) })}
                      disabled={submitting}
                      className="h-8 w-full text-right rounded-md border border-border-subtle bg-bg-input px-2 text-sm"
                    />
                  </td>
                  <td className="px-3 py-1.5 text-right text-text-primary tabular-nums">
                    {(it.quantity * it.unitCost).toLocaleString('id-ID', { maximumFractionDigits: 2 })}
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
            <tfoot className="bg-bg-overlay text-sm">
              <tr className="border-t border-border-subtle">
                <td colSpan={4} className="px-3 py-1.5 text-right text-text-secondary">Subtotal</td>
                <td className="px-3 py-1.5 text-right tabular-nums">{subtotal.toLocaleString('id-ID', { maximumFractionDigits: 2 })}</td>
                <td />
              </tr>
              <tr>
                <td colSpan={4} className="px-3 py-1.5 text-right text-text-secondary">VAT</td>
                <td className="px-3 py-1.5 text-right tabular-nums">{vatAmount.toLocaleString('id-ID', { maximumFractionDigits: 2 })}</td>
                <td />
              </tr>
              <tr>
                <td colSpan={4} className="px-3 py-1.5 text-right font-semibold">Total</td>
                <td className="px-3 py-1.5 text-right font-semibold tabular-nums">{total.toLocaleString('id-ID', { maximumFractionDigits: 2 })}</td>
                <td />
              </tr>
            </tfoot>
          </table>
        </div>
      </div>

      <div className="space-y-1">
        <label htmlFor={`${reactId}-notes`} className="text-xs uppercase tracking-widest text-text-secondary">
          Notes
        </label>
        <textarea
          id={`${reactId}-notes`}
          value={value.notes}
          onChange={(e) => patch({ notes: e.target.value.slice(0, NOTES_MAX) })}
          disabled={submitting}
          maxLength={NOTES_MAX}
          rows={2}
          className="w-full rounded-md border border-border-subtle bg-bg-input px-3 py-2 text-sm text-text-primary"
        />
        <div className="text-xs text-text-secondary text-right">{value.notes.length}/{NOTES_MAX}</div>
      </div>

      {error !== undefined && error !== '' && (
        <div role="alert" className="rounded-md border border-danger/30 bg-danger-soft px-3 py-2 text-sm text-danger">
          {error}
        </div>
      )}

      <div className="flex justify-end">
        <Button type="submit" variant="primary" disabled={submitting}>
          {submitting ? 'Saving…' : submitLabel}
        </Button>
      </div>
    </form>
  );
}
