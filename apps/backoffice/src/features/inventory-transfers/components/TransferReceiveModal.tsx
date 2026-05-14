// apps/backoffice/src/features/inventory-transfers/components/TransferReceiveModal.tsx
//
// Session 12 — Phase 3 — modal to record per-item received quantities for a
// pending/in_transit transfer. Each row defaults to the requested qty;
// validation (0 <= received <= requested) runs client-side via
// `validateTransferReceive` before the RPC. Server is authoritative.

import { useEffect, useId, useState, type FormEvent, type JSX } from 'react';
import { Button, Dialog, DialogContent, DialogTitle, DialogDescription, Input } from '@breakery/ui';
import { validateTransferReceive } from '@breakery/domain';
import {
  useReceiveTransfer,
  ReceiveTransferError,
} from '../hooks/useReceiveTransfer.js';

export interface TransferReceiveModalItem {
  id:                 string;
  product_name:       string;
  quantity_requested: number;
  unit:               string;
}

export interface TransferReceiveModalProps {
  open:        boolean;
  onClose:     () => void;
  transferId:  string;
  items:       TransferReceiveModalItem[];
  onReceived?: () => void;
}

export function TransferReceiveModal({
  open,
  onClose,
  transferId,
  items,
  onReceived,
}: TransferReceiveModalProps): JSX.Element {
  const receiveMut = useReceiveTransfer();
  const reactId    = useId();

  // Map item.id -> received qty as a free-text string (so we can validate
  // ">" and "<" without fighting the numeric input).
  const [received,  setReceived ] = useState<Record<string, string>>({});
  const [formError, setFormError] = useState<string | null>(null);

  // Reset state every time we open (or the item list changes identity).
  useEffect(() => {
    if (open) {
      const initial: Record<string, string> = {};
      for (const it of items) {
        initial[it.id] = String(it.quantity_requested);
      }
      setReceived(initial);
      setFormError(null);
    }
  }, [open, items]);

  function setQty(itemId: string, raw: string): void {
    setReceived((cur) => ({ ...cur, [itemId]: raw }));
  }

  function close(): void {
    setFormError(null);
    onClose();
  }

  async function handleSubmit(e: FormEvent): Promise<void> {
    e.preventDefault();
    if (receiveMut.isPending) return;

    // Build payload + requested-map for the client-side validator.
    const payloadItems = items.map((it) => ({
      item_id:           it.id,
      quantity_received: Number.parseFloat(received[it.id] ?? '0'),
    }));
    const requestedMap = new Map<string, number>();
    for (const it of items) requestedMap.set(it.id, it.quantity_requested);

    // Fast-fail: any non-numeric or NaN entry?
    for (const p of payloadItems) {
      if (!Number.isFinite(p.quantity_received)) {
        setFormError('Each row needs a numeric received quantity.');
        return;
      }
    }

    const v = validateTransferReceive(
      { transfer_id: transferId, items: payloadItems },
      requestedMap,
    );
    if (!v.valid) {
      switch (v.code) {
        case 'quantity_received_invalid':
          setFormError('A received quantity is negative or exceeds the requested quantity.');
          break;
        case 'received_items_required':
          setFormError('No items to receive.');
          break;
        case 'item_id_required':
          setFormError('Internal error: a transfer line is missing its id.');
          break;
        case 'duplicate_item_in_received':
          setFormError('Duplicate transfer line in the receive payload.');
          break;
        default:
          setFormError('Invalid input. Please check the quantities.');
      }
      return;
    }

    setFormError(null);
    try {
      await receiveMut.mutateAsync({
        transferId,
        items: payloadItems.map((p) => ({
          itemId:           p.item_id,
          quantityReceived: p.quantity_received,
        })),
      });
      onReceived?.();
      close();
    } catch (err) {
      if (err instanceof ReceiveTransferError) {
        switch (err.code) {
          case 'forbidden':
            setFormError('You no longer have permission to receive transfers. Please refresh.');
            break;
          case 'transfer_not_found':
            setFormError('This transfer was deleted or is no longer available. Refresh the page.');
            break;
          case 'receive_not_allowed_in_status':
            setFormError('This transfer can no longer be received. Its status has changed.');
            break;
          case 'quantity_received_invalid':
            setFormError('A received quantity is invalid. Each must be ≥ 0 and ≤ requested.');
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
    <Dialog open={open} onOpenChange={(o) => { if (!o) close(); }}>
      <DialogContent className="max-w-lg">
        <DialogTitle>Receive transfer</DialogTitle>
        <DialogDescription className="sr-only">
          Record the actual quantity received for each line. Defaults to the requested amount.
        </DialogDescription>

        <form onSubmit={(e) => { void handleSubmit(e); }} noValidate className="space-y-4">
          {formError !== null && (
            <div role="alert" className="rounded-md border border-red bg-red/5 p-2 text-xs text-red">
              {formError}
            </div>
          )}

          <div className="bg-bg-elevated rounded-lg border border-border-subtle overflow-hidden">
            <table className="w-full text-sm">
              <thead className="bg-bg-overlay text-xs uppercase tracking-wide text-text-secondary">
                <tr>
                  <th className="text-left px-3 py-2">Product</th>
                  <th className="text-right px-3 py-2 w-24">Requested</th>
                  <th className="text-right px-3 py-2 w-28">Received</th>
                  <th className="text-left px-3 py-2 w-16">Unit</th>
                </tr>
              </thead>
              <tbody>
                {items.map((it) => {
                  const qtyStr = received[it.id] ?? '';
                  const num    = Number.parseFloat(qtyStr);
                  const invalid =
                    qtyStr !== '' &&
                    (!Number.isFinite(num) || num < 0 || num > it.quantity_requested);
                  const fieldId = `${reactId}-qty-${it.id}`;
                  return (
                    <tr key={it.id} className="border-t border-border-subtle">
                      <td className="px-3 py-2">{it.product_name}</td>
                      <td className="px-3 py-2 text-right font-mono">{it.quantity_requested}</td>
                      <td className="px-3 py-2">
                        <Input
                          id={fieldId}
                          type="number"
                          inputMode="decimal"
                          min={0}
                          max={it.quantity_requested}
                          step="0.001"
                          value={qtyStr}
                          onChange={(e) => setQty(it.id, e.target.value)}
                          aria-invalid={invalid}
                          aria-label={`Received quantity for ${it.product_name}`}
                          className="text-right"
                          disabled={receiveMut.isPending}
                        />
                      </td>
                      <td className="px-3 py-2 font-mono text-xs text-text-secondary">{it.unit}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>

          <div className="flex justify-end gap-2 pt-2">
            <Button type="button" variant="ghost" onClick={close} disabled={receiveMut.isPending}>
              Cancel
            </Button>
            <Button type="submit" variant="primary" disabled={receiveMut.isPending}>
              {receiveMut.isPending ? 'Receiving…' : 'Confirm receive'}
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}
