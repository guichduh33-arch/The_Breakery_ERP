// apps/backoffice/src/features/orders/components/EditOrderItemsModal.tsx
// Session 33 / Wave 3.5 — modal to edit items on an open order.
// 2-col layout (60/40): ProductPicker placeholder left, cart preview right.
// Accumulates OrderEditDiff in local state; "Apply" calls useEditOrderItems
// orchestrator (sequential removes -> updates -> adds).
//
// V1 NOTE: ProductPicker is a stub (text placeholder). Wire to BO product
// search in a follow-up if/when the BO products feature exposes a picker
// component. The diff-state management and Apply flow are fully working.

import { useState, useMemo } from 'react';
import { useEditOrderItems } from '@/features/orders/hooks/useEditOrderItems.js';
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

export function EditOrderItemsModal({ open, onClose, orderId, orderNumber, currentItems }: Props) {
  const [diff, setDiff] = useState<OrderEditDiff>({ removes: [], updates: [], adds: [] });
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
    const pending: PreviewLine[] = diff.adds.map((a, idx) => ({
      id:            `__pending-${idx}`,
      product_id:    a.product_id,
      name_snapshot: '(new item)',
      qty:           a.qty,
      unit_price:    0,
      line_total:    0,
      isPending:     true,
    }));
    return [...kept, ...pending];
  }, [currentItems, diff]);

  const previewSubtotal = previewLines.reduce((s, l) => s + l.line_total, 0);
  const pendingCount = diff.removes.length + diff.updates.length + diff.adds.length;

  const handleApply = async () => {
    try {
      await m.mutateAsync({ orderId, diff });
      onClose();
      setDiff({ removes: [], updates: [], adds: [] });
    } catch {
      // m.error displayed below
    }
  };

  const handleRemove = (orderItemId: string) =>
    setDiff((d) => ({ ...d, removes: [...d.removes, orderItemId] }));

  const handleUpdateQty = (orderItemId: string, qty: number) =>
    setDiff((d) => ({
      ...d,
      updates: [
        ...d.updates.filter((u) => u.order_item_id !== orderItemId),
        { order_item_id: orderItemId, qty },
      ],
    }));

  if (!open) return null;

  return (
    <div role="dialog" aria-modal="true" aria-label={`Edit order ${orderNumber}`} className="fixed inset-0 z-50 flex items-center justify-center bg-black/50">
      <div className="bg-white rounded-lg p-6 w-[1024px] max-w-[95vw] max-h-[90vh] flex flex-col">
        <h2 className="text-lg font-semibold">
          Edit order {orderNumber}{' '}
          <span className="ml-2 inline-block px-2 py-0.5 text-xs bg-blue-100 text-blue-800 rounded">Open</span>
        </h2>
        <div className="mt-4 flex-1 grid grid-cols-[60%_40%] gap-4 overflow-hidden">
          <div className="overflow-auto border rounded p-3" data-testid="product-picker-pane">
            <p className="text-sm text-muted-foreground">
              Product picker placeholder (V1 stub — wire to BO product search later).
            </p>
          </div>
          <div className="overflow-auto border rounded p-3" data-testid="cart-preview">
            <h3 className="font-medium text-sm">Cart preview</h3>
            <ul className="mt-2 divide-y">
              {previewLines.map((l) => (
                <li key={l.id} className="py-2 text-sm flex items-center gap-2">
                  <span className="flex-1">
                    {l.name_snapshot}
                    {l.isPending && <span className="ml-1 text-xs text-blue-600">(new)</span>}
                  </span>
                  <input
                    type="number"
                    min={1}
                    value={l.qty}
                    onChange={(e) => handleUpdateQty(l.id, Math.max(1, Number(e.target.value)))}
                    className="w-16 border rounded px-1 py-0.5 text-sm"
                    data-testid={`qty-${l.id}`}
                  />
                  <span className="w-20 text-right">{l.line_total.toLocaleString('id-ID')}</span>
                  {!l.isPending && (
                    <button
                      type="button"
                      onClick={() => handleRemove(l.id)}
                      className="text-red-600 text-xs"
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
        {m.error && <p className="mt-3 text-sm text-red-600">{m.error.message}</p>}
        <div className="mt-4 flex items-center justify-between border-t pt-3">
          <span className="text-sm text-muted-foreground">{pendingCount} changes pending</span>
          <div className="flex gap-2">
            <button onClick={onClose} className="px-4 py-2 text-sm">Cancel</button>
            <button
              onClick={handleApply}
              disabled={pendingCount === 0 || m.isPending}
              className="px-4 py-2 text-sm bg-blue-600 text-white rounded disabled:opacity-50"
              data-testid="apply-changes"
            >
              {m.isPending ? 'Applying…' : 'Apply changes'}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
