// apps/backoffice/src/features/btob/components/CancelB2bOrderModal.tsx
// Session 56 — DEV-S52-03 : cancel an unpaid b2b_pending invoice.
// Wraps cancel_b2b_order_v1 (reverse JE + sale_void stock + balance).
// Blocked server-side when any allocation exists (order_has_payments).
// One modal opening = one idempotency key (rotated on close, S55 pattern).

import { useRef, useState, type JSX } from 'react';
import {
  Button,
  Dialog, DialogContent, DialogTitle, DialogDescription,
} from '@breakery/ui';
import { useCancelB2bOrder, CancelB2bOrderError } from '../hooks/useCancelB2bOrder.js';

const ERROR_COPY: Record<string, string> = {
  order_has_payments:    'This invoice already has a payment allocated — handle the payment first.',
  order_not_cancellable: 'Only unpaid b2b_pending invoices can be cancelled.',
  reason_required:       'A reason of at least 3 characters is required.',
  permission_denied:     'You do not have permission to cancel B2B invoices (needs b2b.order.cancel).',
  fiscal_period_closed:  'The fiscal period of this invoice is closed.',
  unknown:               'Something went wrong. Please retry.',
};

export interface CancelB2bOrderModalProps {
  open:        boolean;
  orderId:     string;
  orderNumber: string;
  onClose:     () => void;
}

export function CancelB2bOrderModal({ open, orderId, orderNumber, onClose }: CancelB2bOrderModalProps): JSX.Element {
  const cancelMut = useCancelB2bOrder();
  const idempotencyKeyRef = useRef<string>(crypto.randomUUID());
  const [reason, setReason] = useState('');
  const [error, setError]   = useState<string | null>(null);

  function handleClose(): void {
    idempotencyKeyRef.current = crypto.randomUUID(); // new modal = new key
    setReason('');
    setError(null);
    onClose();
  }

  async function handleConfirm(): Promise<void> {
    setError(null);
    if (reason.trim().length < 3) {
      setError(ERROR_COPY['reason_required'] as string);
      return;
    }
    try {
      await cancelMut.mutateAsync({
        orderId,
        reason: reason.trim(),
        idempotencyKey: idempotencyKeyRef.current,
      });
      handleClose();
    } catch (err) {
      const code = err instanceof CancelB2bOrderError ? err.code : 'unknown';
      setError(ERROR_COPY[code] ?? (err as Error).message);
    }
  }

  return (
    <Dialog open={open} onOpenChange={(o) => { if (!o) handleClose(); }}>
      <DialogContent className="max-w-md">
        <DialogTitle>Cancel invoice {orderNumber}</DialogTitle>
        <DialogDescription className="sr-only">
          Cancels an unpaid B2B invoice: reverses its journal entry, restores stock and decreases the customer balance.
        </DialogDescription>
        <div className="space-y-3">
          <div className="rounded border border-red bg-red-soft px-3 py-2 text-xs text-red">
            This reverses the invoice journal entry, restores stock and decreases the
            customer balance. It cannot be undone via UI.
          </div>
          <label className="flex flex-col text-sm">
            Reason (min. 3 characters)
            <textarea
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              rows={2}
              className="mt-1 w-full rounded-md border border-border-subtle bg-bg-input p-2 text-sm text-text-primary"
              data-testid="cb2b-reason"
            />
          </label>
          {error !== null && (
            <div role="alert" className="rounded border border-red bg-red-soft px-3 py-2 text-sm text-red" data-testid="cb2b-error">
              {error}
            </div>
          )}
          <div className="flex justify-end gap-2">
            <Button type="button" variant="ghost" onClick={handleClose} disabled={cancelMut.isPending}>
              Keep invoice
            </Button>
            <Button
              type="button"
              variant="primary"
              onClick={() => { void handleConfirm(); }}
              disabled={cancelMut.isPending || reason.trim().length < 3}
              data-testid="cb2b-confirm"
            >
              {cancelMut.isPending ? 'Cancelling…' : 'Cancel invoice'}
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
