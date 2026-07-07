// apps/backoffice/src/features/orders/components/EditOrderItemsModal.tsx
// Session 33 / Wave 3.5 — modal to edit items on an open order.
// Session 39 / Wave C1 — replace ProductPicker stub with real component.
//
// 2-col layout (60/40): ProductPicker left, cart preview right.
// Accumulates OrderEditDiff in local state; "Apply" calls useEditOrderItems
// orchestrator (sequential removes -> updates -> adds). S33 orchestrator
// and RPCs (add_order_item_v1 / update_order_item_qty_v1 / remove_order_item_v1)
// are UNCHANGED.
//
// addedMeta: preview-enrichment only (name + price for pending adds).
// The diff shape and orchestrator are not aware of addedMeta.

import { useState, useMemo } from 'react';
import { CenterModal } from '@breakery/ui';
import { useEditOrderItems } from '@/features/orders/hooks/useEditOrderItems.js';
import { ProductPicker } from '@/features/orders/components/ProductPicker.js';
import type { OrderEditProduct } from '@/features/orders/hooks/useProductsForOrderEdit.js';
import type { OrderEditDiff, OrderItemEdit } from '@/features/orders/types.js';

interface Props {
  open:         boolean;
  onClose:      () => void;
  orderId:      string;
  orderNumber:  string;
  currentItems: OrderItemEdit[];
}

interface PreviewLine {
  id:            string;
  product_id:    string;
  name_snapshot: string;
  qty:           number;
  unit_price:    number;
  line_total:    number;
  isPending?:    boolean;
}

const EMPTY_DIFF: OrderEditDiff = { removes: [], updates: [], adds: [] };

export function EditOrderItemsModal({ open, onClose, orderId, orderNumber, currentItems }: Props) {
  const [diff, setDiff] = useState<OrderEditDiff>(EMPTY_DIFF);
  // Preview-only metadata for pending adds (name / price from the picker).
  // Not sent to the server — the RPC resolves the real price from the DB.
  const [addedMeta, setAddedMeta] = useState<Record<string, { name: string; retail_price: number }>>({});
  const m = useEditOrderItems();

  const previewLines = useMemo<PreviewLine[]>(() => {
    const kept: PreviewLine[] = currentItems
      .filter((it) => !diff.removes.includes(it.id))
      .map((it) => {
        const u = diff.updates.find((x) => x.order_item_id === it.id);
        const qty = u ? u.qty : it.qty;
        return {
          id:            it.id,
          product_id:    it.product_id,
          name_snapshot: it.name_snapshot,
          qty,
          unit_price:    it.unit_price,
          line_total:    it.unit_price * qty,
        };
      });
    const pending: PreviewLine[] = diff.adds.map((a, idx) => {
      const meta = addedMeta[a.product_id];
      const unit_price = meta?.retail_price ?? 0;
      return {
        id:            `__pending-${idx}`,
        product_id:    a.product_id,
        name_snapshot: meta?.name ?? '(new item)',
        qty:           a.qty,
        unit_price,
        line_total:    unit_price * a.qty,
        isPending:     true,
      };
    });
    return [...kept, ...pending];
  }, [currentItems, diff, addedMeta]);

  const previewSubtotal = previewLines.reduce((s, l) => s + l.line_total, 0);
  const pendingCount = diff.removes.length + diff.updates.length + diff.adds.length;

  const resetState = () => {
    setDiff(EMPTY_DIFF);
    setAddedMeta({});
  };

  const handleApply = async () => {
    try {
      await m.mutateAsync({ orderId, diff });
      resetState();
      onClose();
    } catch {
      // m.error displayed below
    }
  };

  const handleCancel = () => {
    resetState();
    onClose();
  };

  const handlePick = (p: OrderEditProduct) => {
    setAddedMeta((meta) => ({ ...meta, [p.id]: { name: p.name, retail_price: p.retail_price } }));
    setDiff((d) => {
      const existing = d.adds.find((a) => a.product_id === p.id);
      if (existing) {
        return { ...d, adds: d.adds.map((a) => a.product_id === p.id ? { ...a, qty: a.qty + 1 } : a) };
      }
      return { ...d, adds: [...d.adds, { product_id: p.id, qty: 1 }] };
    });
  };

  const handleRemove = (orderItemId: string) =>
    setDiff((d) => ({ ...d, removes: [...d.removes, orderItemId] }));

  const handleRemovePending = (productId: string) =>
    setDiff((d) => ({ ...d, adds: d.adds.filter((a) => a.product_id !== productId) }));

  // For existing items: write to diff.updates.
  // For pending adds: write to diff.adds qty.
  const handleUpdateQty = (lineId: string, productId: string, qty: number, isPending: boolean) => {
    if (isPending) {
      setDiff((d) => ({
        ...d,
        adds: d.adds.map((a) => a.product_id === productId ? { ...a, qty } : a),
      }));
    } else {
      setDiff((d) => ({
        ...d,
        updates: [
          ...d.updates.filter((u) => u.order_item_id !== lineId),
          { order_item_id: lineId, qty },
        ],
      }));
    }
  };

  return (
    <CenterModal
      open={open}
      onOpenChange={(o) => { if (!o) handleCancel(); }}
      title={`Edit order ${orderNumber}`}
      className="w-[min(1024px,95vw)] max-h-[90vh] p-6"
    >
        <h2 className="text-lg font-semibold">
          Edit order {orderNumber}{' '}
          <span className="ml-2 inline-block px-2 py-0.5 text-xs bg-info-soft text-info rounded">Open</span>
        </h2>
        <div className="mt-4 flex-1 grid grid-cols-[60%_40%] gap-4 overflow-hidden">
          <div className="overflow-auto border rounded p-3" data-testid="product-picker-pane">
            <ProductPicker onPick={handlePick} />
          </div>
          <div className="overflow-auto border rounded p-3" data-testid="cart-preview">
            <h3 className="font-medium text-sm">Cart preview</h3>
            <ul className="mt-2 divide-y">
              {previewLines.map((l) => (
                <li key={l.id} className="py-2 text-sm flex items-center gap-2">
                  <span className="flex-1">
                    {l.name_snapshot}
                    {l.isPending && <span className="ml-1 text-xs text-info">(new)</span>}
                  </span>
                  <input
                    type="number"
                    min={1}
                    value={l.qty}
                    onChange={(e) =>
                      handleUpdateQty(l.id, l.product_id, Math.max(1, Number(e.target.value) || 1), !!l.isPending)
                    }
                    className="w-16 border rounded px-1 py-0.5 text-sm"
                    data-testid={`qty-${l.id}`}
                  />
                  <span className="w-20 text-right">{l.line_total.toLocaleString('id-ID')}</span>
                  {l.isPending ? (
                    <button
                      type="button"
                      onClick={() => handleRemovePending(l.product_id)}
                      className="text-danger text-xs"
                      data-testid={`remove-pending-${l.product_id}`}
                      aria-label={`Remove ${l.name_snapshot}`}
                    >
                      ×
                    </button>
                  ) : (
                    <button
                      type="button"
                      onClick={() => handleRemove(l.id)}
                      className="text-danger text-xs"
                      data-testid={`remove-${l.id}`}
                      aria-label={`Remove ${l.name_snapshot}`}
                    >
                      ×
                    </button>
                  )}
                </li>
              ))}
            </ul>
            <p className="mt-3 text-sm border-t pt-2">
              Subtotal preview: <strong>{previewSubtotal.toLocaleString('id-ID')}</strong>
            </p>
            <p className="text-xs text-muted-foreground">Tax + total recalculated server-side at apply.</p>
          </div>
        </div>
        {m.error && <p className="mt-3 text-sm text-danger">{m.error.message}</p>}
        <div className="mt-4 flex items-center justify-between border-t pt-3">
          <span className="text-sm text-muted-foreground">{pendingCount} changes pending</span>
          <div className="flex gap-2">
            <button onClick={handleCancel} className="px-4 py-2 text-sm">Cancel</button>
            <button
              onClick={() => { void handleApply(); }}
              disabled={pendingCount === 0 || m.isPending}
              className="px-4 py-2 text-sm bg-info text-white rounded disabled:opacity-50"
              data-testid="apply-changes"
            >
              {m.isPending ? 'Applying…' : 'Apply changes'}
            </button>
          </div>
        </div>
    </CenterModal>
  );
}
