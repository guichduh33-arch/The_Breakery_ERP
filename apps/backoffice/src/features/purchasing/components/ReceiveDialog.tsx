// apps/backoffice/src/features/purchasing/components/ReceiveDialog.tsx
//
// Session 13 — Phase 3.A — Modal for entering received qty per line. Submits to
// the receive_purchase_order RPC via the parent's onConfirm callback.
//
// Phase 4.D — migrated from ad-hoc <div> overlay to @breakery/ui Radix Dialog.
//
// ADR-027 — plus de sélecteur « Receive into section » : le stock est global,
// une réception ne demande plus aucun choix d'emplacement.

import { useMemo, useRef, useState, type JSX } from 'react';
import {
  Button,
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from '@breakery/ui';
import type { PurchaseOrderDetail } from '../hooks/usePurchaseOrderDetail.js';

export interface ReceiveDialogProps {
  po:        PurchaseOrderDetail;
  onCancel:  () => void;
  onConfirm: (args: {
    items: { poItemId: string; receivedQuantity: number }[];
    idempotencyKey: string;
  }) => Promise<void>;
  submitting?: boolean;
  error?:    string;
}

export function ReceiveDialog({
  po, onCancel, onConfirm,
  submitting = false, error,
}: ReceiveDialogProps): JSX.Element {
  // Stable idempotency key for this dialog session (survives retries / re-renders).
  // A lost response + re-click replays the same GRN server-side instead of doubling it.
  const idempotencyKey = useRef<string>(crypto.randomUUID());
  const [qtyByItem, setQtyByItem] = useState<Record<string, number>>(() => {
    const m: Record<string, number> = {};
    for (const it of po.purchase_order_items) {
      m[it.id] = Math.max(0, Number(it.quantity) - Number(it.received_quantity));
    }
    return m;
  });

  const remaining = useMemo(() => {
    const m: Record<string, number> = {};
    for (const it of po.purchase_order_items) {
      m[it.id] = Number(it.quantity) - Number(it.received_quantity);
    }
    return m;
  }, [po.purchase_order_items]);

  const itemsWithQty = po.purchase_order_items
    .map((it) => ({ poItemId: it.id, receivedQuantity: qtyByItem[it.id] ?? 0 }))
    .filter((it) => it.receivedQuantity > 0);

  const canSubmit = itemsWithQty.length > 0 && !submitting;

  function patchQty(itemId: string, qty: number): void {
    setQtyByItem((m) => ({ ...m, [itemId]: qty }));
  }

  async function handleConfirm(): Promise<void> {
    if (!canSubmit) return;
    await onConfirm({ items: itemsWithQty, idempotencyKey: idempotencyKey.current });
  }

  return (
    <Dialog open onOpenChange={(o) => { if (!o && !submitting) onCancel(); }}>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle>Receive goods</DialogTitle>
          <DialogDescription>PO {po.po_number}</DialogDescription>
        </DialogHeader>

        <div className="space-y-3 max-h-[60vh] overflow-y-auto">
          <div className="overflow-x-auto border border-border-subtle rounded-md">
            <table className="w-full text-sm">
              <thead className="bg-bg-overlay text-text-secondary text-xs uppercase tracking-widest">
                <tr>
                  <th className="text-left px-3 py-2">Product</th>
                  <th className="text-right px-3 py-2 w-24">Ordered</th>
                  <th className="text-right px-3 py-2 w-24">Already</th>
                  <th className="text-right px-3 py-2 w-24">Remaining</th>
                  <th className="text-right px-3 py-2 w-28">Receive now</th>
                </tr>
              </thead>
              <tbody>
                {po.purchase_order_items.map((it) => {
                  const remain = remaining[it.id] ?? 0;
                  return (
                    <tr key={it.id} className="border-t border-border-subtle">
                      <td className="px-3 py-2">
                        {it.products?.name ?? '?'}{' '}
                        <span className="text-text-secondary text-xs">({it.products?.sku ?? '—'})</span>
                      </td>
                      <td className="px-3 py-2 text-right tabular-nums">{Number(it.quantity)}</td>
                      <td className="px-3 py-2 text-right tabular-nums">{Number(it.received_quantity)}</td>
                      <td className="px-3 py-2 text-right tabular-nums">{remain}</td>
                      <td className="px-3 py-2">
                        <input
                          type="number"
                          min={0}
                          max={remain}
                          step={0.001}
                          value={qtyByItem[it.id] ?? 0}
                          onChange={(e) => patchQty(it.id, Math.min(remain, Math.max(0, Number(e.target.value))))}
                          disabled={submitting || remain <= 0}
                          className="h-8 w-24 text-right rounded-md border border-border-subtle bg-bg-input px-2 text-sm"
                          aria-label={`Receive qty for ${it.products?.name ?? it.id}`}
                        />
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          {error !== undefined && error !== '' && (
            <div role="alert" className="rounded-md border border-danger bg-danger-soft px-3 py-2 text-sm text-danger">
              {error}
            </div>
          )}
        </div>

        <DialogFooter>
          <Button type="button" variant="ghost" onClick={onCancel} disabled={submitting}>Cancel</Button>
          <Button
            type="button"
            variant="ink"
            onClick={() => { void handleConfirm(); }}
            disabled={!canSubmit}
          >
            {submitting ? 'Receiving…' : 'Confirm receipt'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
