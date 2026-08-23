// apps/pos/src/features/order-history/components/VoidOrderModal.tsx
//
// Session 10 — full void confirmation. Reason input + manager PIN.
// Mirrors CancelItemModal layout for consistency.

import { useRef, useState, type JSX } from 'react';
import { X } from 'lucide-react';
import { Button, NumpadPin, FullScreenModal, cn, Input, Currency } from '@breakery/ui';
import { toast } from 'sonner';

export interface VoidOrderModalProps {
  open: boolean;
  onClose: () => void;
  orderNumber: string;
  total: number;
  onSubmit: (args: { reason: string; managerPin: string; idempotencyKey: string }) => Promise<void> | void;
  isPending?: boolean;
}

export function VoidOrderModal({
  open, onClose, orderNumber, total, onSubmit, isPending = false,
}: VoidOrderModalProps): JSX.Element {
  const [reason, setReason] = useState('');
  const [pinKey, setPinKey] = useState(0);
  // Lot 2 harden — erreur inline armée après tentative (WCAG 3.3.1).
  const [reasonError, setReasonError] = useState(false);
  // S55 — one UUID per "modal open session", sticky across re-renders and retries
  // (never regenerated inside onSubmit, so RQ auto-retries reuse it). Rotated on
  // close (dismiss or post-success) so the next open gets a fresh key.
  const idempotencyKeyRef = useRef<string>(crypto.randomUUID());

  function handleClose(): void {
    setReason('');
    setReasonError(false);
    setPinKey((k) => k + 1);
    idempotencyKeyRef.current = crypto.randomUUID();
    onClose();
  }

  async function handlePinSubmit(pin: string): Promise<void> {
    if (reason.trim().length < 3) {
      // Lot 2 harden — l'erreur s'arme aussi inline au champ (WCAG 3.3.1).
      setReasonError(true);
      toast.error('Reason required (≥ 3 chars)');
      setPinKey((k) => k + 1);
      return;
    }
    try {
      await onSubmit({ reason: reason.trim(), managerPin: pin, idempotencyKey: idempotencyKeyRef.current });
      handleClose();
    } catch {
      setPinKey((k) => k + 1);
    }
  }

  return (
    <FullScreenModal
      open={open}
      onOpenChange={(o) => { if (!o) handleClose(); }}
      accessibleTitle={`Void order ${orderNumber}`}
    >
      <div className="flex flex-col items-center justify-center min-h-dvh bg-bg-base p-6">
        <div className="w-full max-w-md space-y-6 rounded-lg border border-red-as-text bg-bg-elevated p-8">
          <div className="flex items-center justify-between">
            <div>
              <div className="text-xs uppercase tracking-widest text-red-as-text">Void Order</div>
              <div className="font-bold text-xl text-text-primary mt-1">{orderNumber}</div>
              <div className="text-xs text-text-secondary mt-1">
                Total to refund: <Currency amount={total} className="text-text-primary" />
              </div>
            </div>
            <button type="button" aria-label="Close" onClick={handleClose} className="text-text-secondary hover:text-text-primary">
              <X className="h-5 w-5" aria-hidden />
            </button>
          </div>

          <div>
            <label className="text-xs uppercase tracking-widest text-text-secondary mb-2 block">
              Reason
            </label>
            <Input
              value={reason}
              onChange={(e) => { setReason(e.target.value); setReasonError(false); }}
              placeholder="e.g. wrong order, customer cancelled…"
              className={cn('w-full', ((reason.trim().length > 0 && reason.trim().length < 3) || reasonError) && 'border-red-as-text')}
              disabled={isPending}
              aria-invalid={(reason.length > 0 && reason.trim().length < 3) || reasonError}
              {...(((reason.length > 0 && reason.trim().length < 3) || reasonError)
                ? { 'aria-describedby': 'void-hist-reason-error' } : {})}
            />
            {((reason.length > 0 && reason.trim().length < 3) || reasonError) && (
              <div id="void-hist-reason-error" role="alert" className="mt-1 text-xs text-red-as-text">
                Reason must be at least 3 characters
              </div>
            )}
          </div>

          <div>
            <div className="text-xs uppercase tracking-widest text-text-secondary mb-2">
              Manager PIN
            </div>
            <NumpadPin
              key={pinKey}
              maxLength={6}
              onSubmit={(pin) => { void handlePinSubmit(pin); }}
              isLoading={isPending}
            />
          </div>

          <Button variant="secondary" className="w-full" onClick={handleClose} disabled={isPending}>
            Cancel
          </Button>
        </div>
      </div>
    </FullScreenModal>
  );
}
