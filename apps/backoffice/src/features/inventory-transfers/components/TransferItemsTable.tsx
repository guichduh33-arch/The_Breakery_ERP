// apps/backoffice/src/features/inventory-transfers/components/TransferItemsTable.tsx
//
// Session 12 — Phase 3 — editable items list for the New Transfer form.
//   - Bottom row uses the shared `ProductTypeahead` so users can pick a
//     product without leaving the form.
//   - Each row has a numeric quantity input + trash button.
//   - Shows a running total of distinct items.
//
// Quantity validation (qty > 0, duplicates, etc.) is delegated to
// `validateTransferInput` at the page level. This component only emits
// state updates.

import { useState, type JSX } from 'react';
import { Trash2 } from 'lucide-react';
import { Button, Input } from '@breakery/ui';
import { ProductTypeahead } from '@/features/inventory/components/ProductTypeahead.js';
import type { ProductTypeaheadRow } from '@/features/inventory/hooks/useProductsForInventory.js';

export interface TransferItemDraft {
  productId:   string;
  productName: string;
  quantity:    number;
  unit:        string;
}

export interface TransferItemsTableProps {
  items:    TransferItemDraft[];
  onChange: (next: TransferItemDraft[]) => void;
  disabled?: boolean;
}

export function TransferItemsTable({
  items,
  onChange,
  disabled = false,
}: TransferItemsTableProps): JSX.Element {
  const [pendingProduct, setPendingProduct] = useState<ProductTypeaheadRow | null>(null);
  const [pendingQty,     setPendingQty    ] = useState<string>('');

  function addRow(): void {
    if (pendingProduct === null) return;
    const qty = Number.parseFloat(pendingQty);
    if (!Number.isFinite(qty) || qty <= 0) return;
    if (items.some((it) => it.productId === pendingProduct.id)) return;

    onChange([
      ...items,
      {
        productId:   pendingProduct.id,
        productName: pendingProduct.name,
        quantity:    qty,
        unit:        'pcs', // unit resolved server-side via products.unit fallback.
      },
    ]);
    setPendingProduct(null);
    setPendingQty('');
  }

  function updateQty(idx: number, raw: string): void {
    const qty = Number.parseFloat(raw);
    const next = items.slice();
    const existing = next[idx];
    if (existing === undefined) return;
    next[idx] = { ...existing, quantity: Number.isFinite(qty) ? qty : 0 };
    onChange(next);
  }

  function removeRow(idx: number): void {
    onChange(items.filter((_, i) => i !== idx));
  }

  const pendingQtyValid =
    pendingProduct !== null &&
    pendingQty !== '' &&
    Number.isFinite(Number.parseFloat(pendingQty)) &&
    Number.parseFloat(pendingQty) > 0 &&
    !items.some((it) => it.productId === pendingProduct.id);

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <h3 className="text-xs uppercase tracking-widest text-text-secondary">Items</h3>
        <span className="text-text-secondary text-xs">{items.length} line{items.length === 1 ? '' : 's'}</span>
      </div>

      {items.length > 0 && (
        <div className="bg-bg-elevated rounded-lg border border-border-subtle overflow-hidden">
          <table className="w-full text-sm">
            <thead className="bg-bg-overlay text-xs uppercase tracking-wide text-text-secondary">
              <tr>
                <th className="text-left px-3 py-2">Product</th>
                <th className="text-right px-3 py-2 w-32">Quantity</th>
                <th className="text-left px-3 py-2 w-20">Unit</th>
                <th className="px-3 py-2 w-12" />
              </tr>
            </thead>
            <tbody>
              {items.map((it, idx) => (
                <tr key={it.productId} className="border-t border-border-subtle">
                  <td className="px-3 py-2">{it.productName}</td>
                  <td className="px-3 py-2">
                    <Input
                      type="number"
                      inputMode="decimal"
                      min={0.001}
                      step="0.001"
                      value={String(it.quantity)}
                      onChange={(e) => updateQty(idx, e.target.value)}
                      disabled={disabled}
                      aria-label={`Quantity for ${it.productName}`}
                      className="text-right"
                    />
                  </td>
                  <td className="px-3 py-2 font-mono text-xs text-text-secondary">{it.unit}</td>
                  <td className="px-3 py-2 text-right">
                    <Button
                      type="button"
                      variant="ghostDestructive"
                      size="sm"
                      onClick={() => removeRow(idx)}
                      disabled={disabled}
                      aria-label={`Remove ${it.productName}`}
                    >
                      <Trash2 className="h-4 w-4" aria-hidden />
                    </Button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <div className="grid grid-cols-[1fr_8rem_auto] gap-2 items-end bg-bg-elevated border border-border-subtle rounded-lg p-3">
        <div className="space-y-1">
          <label className="text-xs uppercase tracking-widest text-text-secondary">Add product</label>
          <ProductTypeahead
            value={pendingProduct}
            onChange={setPendingProduct}
            disabled={disabled}
            placeholder="Search by name (min 2 chars)…"
          />
        </div>
        <div className="space-y-1">
          <label htmlFor="transfer-pending-qty" className="text-xs uppercase tracking-widest text-text-secondary">
            Qty
          </label>
          <Input
            id="transfer-pending-qty"
            type="number"
            inputMode="decimal"
            min={0.001}
            step="0.001"
            value={pendingQty}
            onChange={(e) => setPendingQty(e.target.value)}
            disabled={disabled || pendingProduct === null}
          />
        </div>
        <Button
          type="button"
          variant="secondary"
          onClick={addRow}
          disabled={disabled || !pendingQtyValid}
        >
          Add line
        </Button>
      </div>
    </div>
  );
}
