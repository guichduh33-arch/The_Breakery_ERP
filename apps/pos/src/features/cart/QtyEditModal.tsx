// apps/pos/src/features/cart/QtyEditModal.tsx
//
// Quantity editor for a cart line — replaces the old always-on ±152px stepper
// (cart redesign v2). The line's qty chip opens this; the cashier types the
// exact count on the Numpad (one tap to reach "12 croissants" instead of 11
// increments). Confirming 0 removes the line (routed through the parent's undo
// path).
//
// Lifted to ActiveOrderPanel (mirrors the DiscountModal / CancelItemModal
// pattern) so there is a single modal instance, not one per row.

import { useEffect, useState, type JSX } from 'react';
import { Button, CenterModal, Numpad } from '@breakery/ui';

export interface QtyEditModalProps {
  open: boolean;
  itemName: string;
  currentQty: number;
  onClose: () => void;
  /** Called with the new quantity. 0 means "remove this line". */
  onConfirm: (qty: number) => void;
}

export function QtyEditModal({
  open,
  itemName,
  currentQty,
  onClose,
  onConfirm,
}: QtyEditModalProps): JSX.Element {
  // Buffer starts empty: the first digit typed replaces the current qty (POS
  // convention — you rarely edit a digit, you re-key the whole count).
  const [buf, setBuf] = useState('');

  useEffect(() => {
    if (open) setBuf('');
  }, [open]);

  const parsed = buf === '' ? currentQty : parseInt(buf, 10);
  const display = Number.isNaN(parsed) ? 0 : parsed;

  function confirm(): void {
    onConfirm(display);
    onClose();
  }

  return (
    <CenterModal
      open={open}
      onOpenChange={(o) => !o && onClose()}
      className="w-[min(360px,92vw)]"
      title={`Quantity — ${itemName}`}
    >
      <div className="flex flex-col gap-4 p-5">
        <div className="text-center">
          <p className="text-xs uppercase tracking-widest text-text-muted">Quantity</p>
          <p className="mt-1 truncate text-sm font-semibold text-text-primary">{itemName}</p>
          <p className="mt-2 font-mono tabular-nums text-4xl font-bold text-gold">{display}</p>
        </div>

        <Numpad value={buf} onChange={setBuf} maxLength={3} />

        <div className="grid grid-cols-2 gap-3">
          <Button variant="secondary" onClick={onClose} className="h-touch-comfy">
            Cancel
          </Button>
          <Button variant="primary" onClick={confirm} className="h-touch-comfy">
            {display === 0 ? 'Remove' : 'Set'}
          </Button>
        </div>
      </div>
    </CenterModal>
  );
}
