// apps/backoffice/src/features/orders/components/VoidOrderModal.tsx
// Session 33 / Wave 3.4 — modal to void an order from the BO list page.
// Reason textarea (min 10 chars) + 6-digit manager PIN. Submit disabled
// until both validate. PIN travels in the `x-manager-pin` header (S34);
// idempotency key in `x-idempotency-key` (S55 parity, S60).

import { useState, useRef } from 'react';
import { useVoidOrder } from '@/features/orders/hooks/useVoidOrder.js';

interface Props {
  open:        boolean;
  onClose:     () => void;
  orderId:     string;
  orderNumber: string;
}

export function VoidOrderModal({ open, onClose, orderId, orderNumber }: Props) {
  const [reason, setReason] = useState('');
  const [pin, setPin]       = useState('');
  const idem = useRef(crypto.randomUUID());
  const m = useVoidOrder();

  if (!open) return null;

  const reasonOk = reason.trim().length >= 10;
  const pinOk    = /^\d{6}$/.test(pin);
  const canSubmit = reasonOk && pinOk && !m.isPending;

  const handleSubmit = async () => {
    if (!canSubmit) return;
    try {
      await m.mutateAsync({ orderId, reason, managerPin: pin, idempotencyKey: idem.current });
      onClose();
      setReason('');
      setPin('');
      idem.current = crypto.randomUUID();
    } catch {
      // m.error displayed below
    }
  };

  const handleClose = () => {
    idem.current = crypto.randomUUID();
    onClose();
  };

  return (
    <div role="dialog" aria-modal="true" aria-label={`Void order ${orderNumber}`} className="fixed inset-0 z-50 flex items-center justify-center bg-black/50">
      <div className="bg-white rounded-lg p-6 w-[480px] max-w-[90vw]">
        <h2 className="text-lg font-semibold">Void order {orderNumber}</h2>
        <p className="mt-2 rounded bg-red-50 border border-red-200 p-3 text-sm text-red-900">
          This action cannot be undone. Inventory will be restored to stock.
        </p>
        <div className="mt-4">
          <label className="block text-sm font-medium">Reason for voiding</label>
          <textarea
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            rows={3}
            className="mt-1 w-full border rounded p-2 text-sm"
            placeholder="Min. 10 characters…"
            data-testid="void-reason"
          />
          {!reasonOk && reason.length > 0 && <p className="text-xs text-red-600 mt-1">Min. 10 characters</p>}
        </div>
        <div className="mt-4">
          <label className="block text-sm font-medium">Manager PIN</label>
          <input
            type="password"
            inputMode="numeric"
            maxLength={6}
            value={pin}
            onChange={(e) => setPin(e.target.value.replace(/\D/g, ''))}
            className="mt-1 w-full border rounded p-2 text-sm tracking-widest"
            data-testid="void-pin"
          />
        </div>
        {m.error && <p className="mt-3 text-sm text-red-600" data-testid="void-error">{m.error.message}</p>}
        <div className="mt-6 flex justify-end gap-2">
          <button onClick={handleClose} className="px-4 py-2 text-sm" data-testid="void-cancel">Cancel</button>
          <button
            onClick={handleSubmit}
            disabled={!canSubmit}
            className="px-4 py-2 text-sm bg-red-600 text-white rounded disabled:opacity-50"
            data-testid="void-submit"
          >
            {m.isPending ? 'Voiding…' : 'Void order'}
          </button>
        </div>
      </div>
    </div>
  );
}
