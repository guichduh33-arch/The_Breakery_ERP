// apps/pos/src/features/cart/VoidOrderModal.tsx
//
// Void the whole order — single-step modal capturing (a) a mandatory free-text
// reason and (b) the manager 6-digit PIN, then submitting. Owner decision
// 2026-07-10: Void lives under "More" and ALWAYS requires manager PIN + a reason
// (not only once fired), so an accidental void is impossible and every void is
// attributable. Mirrors CancelItemModal (same reason+PIN pattern / NumpadPin).

import { useRef, useState, type JSX } from 'react';
import { X } from 'lucide-react';
import { Button, NumpadPin, FullScreenModal, cn, Input } from '@breakery/ui';
import { toast } from 'sonner';

export interface VoidOrderModalProps {
  open: boolean;
  onClose: () => void;
  /** True once items were fired — surfaces that a server void will run. */
  fired?: boolean;
  /** Called once the cashier has provided BOTH a valid reason AND PIN. */
  onSubmit: (args: { reason: string; managerPin: string; idempotencyKey: string }) => Promise<void> | void;
  isPending?: boolean;
}

export function VoidOrderModal({
  open,
  onClose,
  fired = false,
  onSubmit,
  isPending = false,
}: VoidOrderModalProps): JSX.Element {
  const [reason, setReason] = useState('');
  const [pinKey, setPinKey] = useState(0);
  // One UUID per "modal open session", sticky across re-renders/retries; rotated
  // on close so the next open gets a fresh key (idempotency for the server void).
  const idempotencyKeyRef = useRef<string>(crypto.randomUUID());

  function handleClose(): void {
    setReason('');
    setPinKey((k) => k + 1);
    idempotencyKeyRef.current = crypto.randomUUID();
    onClose();
  }

  async function handlePinSubmit(pin: string): Promise<void> {
    if (reason.trim().length < 3) {
      toast.error('Reason required (≥ 3 chars)');
      setPinKey((k) => k + 1);
      return;
    }
    try {
      await onSubmit({ reason: reason.trim(), managerPin: pin, idempotencyKey: idempotencyKeyRef.current });
      handleClose();
    } catch {
      // The caller surfaces its own toast; clear the PIN to allow a retry.
      setPinKey((k) => k + 1);
    }
  }

  return (
    <FullScreenModal open={open} onOpenChange={(o) => { if (!o) handleClose(); }}>
      <div
        role="alertdialog"
        aria-label="Void order"
        className="flex flex-col items-center justify-center min-h-screen bg-bg-base p-6"
      >
        <div className="w-full max-w-md space-y-6 rounded-lg border border-red-fg/30 bg-bg-elevated p-8">
          <div className="flex items-center justify-between">
            <div>
              <div className="text-xs uppercase tracking-widest text-red-fg">Void order</div>
              <div className="font-serif text-xl text-text-primary mt-1">
                Cancel the entire order?
              </div>
            </div>
            <button
              type="button"
              aria-label="Close"
              onClick={handleClose}
              className="text-text-secondary hover:text-text-primary"
            >
              <X className="h-5 w-5" aria-hidden />
            </button>
          </div>

          <p className="text-sm text-text-secondary">
            {fired
              ? 'Items were already sent to the kitchen. This voids the order server-side and cannot be undone.'
              : 'All items in the current cart will be removed. This cannot be undone.'}
          </p>

          <div>
            <label className="text-xs uppercase tracking-widest text-text-secondary mb-2 block">
              Reason
            </label>
            <Input
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              placeholder="e.g. customer left, wrong order, duplicate…"
              className={cn('w-full', reason.trim().length > 0 && reason.trim().length < 3 && 'border-red-fg/30')}
              disabled={isPending}
              aria-label="Void reason"
              data-vkp="qwerty"
            />
            {reason.length > 0 && reason.trim().length < 3 && (
              <div className="mt-1 text-xs text-red-fg">Reason must be at least 3 characters</div>
            )}
          </div>

          <div>
            <div className="text-xs uppercase tracking-widest text-text-secondary mb-2">
              Manager PIN (6 digits)
            </div>
            <NumpadPin
              key={pinKey}
              maxLength={6}
              onSubmit={(pin) => { void handlePinSubmit(pin); }}
              isLoading={isPending}
            />
          </div>

          <Button
            variant="secondary"
            className="w-full"
            onClick={handleClose}
            disabled={isPending}
            data-testid="void-modal-cancel"
          >
            Cancel
          </Button>
        </div>
      </div>
    </FullScreenModal>
  );
}
