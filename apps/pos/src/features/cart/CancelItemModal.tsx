// apps/pos/src/features/cart/CancelItemModal.tsx
//
// Session 10 — single-step modal that captures (a) a free-text reason and
// (b) the manager 6-digit PIN, then submits to the cancel-item EF.
// Reuses the NumpadPin primitive for consistent PIN entry UX.

import { useRef, useState, type JSX } from 'react';
import { X } from 'lucide-react';
import { Button, NumpadPin, FullScreenModal, cn, Input } from '@breakery/ui';
import { toast } from 'sonner';

export interface CancelItemModalProps {
  open: boolean;
  onClose: () => void;
  itemName: string;
  /** Called once the cashier has provided BOTH a valid reason AND PIN. */
  onSubmit: (args: { reason: string; managerPin: string; idempotencyKey: string }) => Promise<void> | void;
  isPending?: boolean;
}

export function CancelItemModal({
  open,
  onClose,
  itemName,
  onSubmit,
  isPending = false,
}: CancelItemModalProps): JSX.Element {
  const [reason, setReason] = useState('');
  const [pinKey, setPinKey] = useState(0);
  // S55 — one UUID per "modal open session", sticky across re-renders and retries
  // (never regenerated inside onSubmit, so RQ auto-retries reuse it). Rotated on
  // close (dismiss or post-success) so the next open gets a fresh key.
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
      // The mutation surface its own toast ; clear PIN to allow retry.
      setPinKey((k) => k + 1);
    }
  }

  return (
    <FullScreenModal open={open} onOpenChange={(o) => { if (!o) handleClose(); }}>
      <div
        role="dialog"
        aria-label={`Cancel item: ${itemName}`}
        className="flex flex-col items-center justify-center min-h-screen bg-bg-base p-6"
      >
        <div className="w-full max-w-md space-y-6 rounded-lg border border-red-400/30 bg-bg-elevated p-8">
          <div className="flex items-center justify-between">
            <div>
              <div className="text-xs uppercase tracking-widest text-red-400">Cancel Item</div>
              <div className="font-serif text-xl text-text-primary mt-1">{itemName}</div>
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

          <div>
            <label className="text-xs uppercase tracking-widest text-text-secondary mb-2 block">
              Reason
            </label>
            <Input
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              placeholder="e.g. wrong order, customer changed mind…"
              className={cn('w-full', reason.trim().length > 0 && reason.trim().length < 3 && 'border-red-400')}
              disabled={isPending}
              data-vkp="qwerty"
            />
            {reason.length > 0 && reason.trim().length < 3 && (
              <div className="mt-1 text-xs text-red-400">Reason must be at least 3 characters</div>
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
          >
            Cancel
          </Button>
        </div>
      </div>
    </FullScreenModal>
  );
}
