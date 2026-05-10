// apps/pos/src/features/order-history/components/VoidOrderModal.tsx
//
// Session 10 — full void confirmation. Reason input + manager PIN.
// Mirrors CancelItemModal layout for consistency.

import { useState, type JSX } from 'react';
import { X } from 'lucide-react';
import { Button, NumpadPin, FullScreenModal, cn, Input, Currency } from '@breakery/ui';
import { toast } from 'sonner';

export interface VoidOrderModalProps {
  open: boolean;
  onClose: () => void;
  orderNumber: string;
  total: number;
  onSubmit: (args: { reason: string; managerPin: string }) => Promise<void> | void;
  isPending?: boolean;
}

export function VoidOrderModal({
  open, onClose, orderNumber, total, onSubmit, isPending = false,
}: VoidOrderModalProps): JSX.Element {
  const [reason, setReason] = useState('');
  const [pinKey, setPinKey] = useState(0);

  function handleClose(): void {
    setReason('');
    setPinKey((k) => k + 1);
    onClose();
  }

  async function handlePinSubmit(pin: string): Promise<void> {
    if (reason.trim().length < 3) {
      toast.error('Reason required (≥ 3 chars)');
      setPinKey((k) => k + 1);
      return;
    }
    try {
      await onSubmit({ reason: reason.trim(), managerPin: pin });
      handleClose();
    } catch {
      setPinKey((k) => k + 1);
    }
  }

  return (
    <FullScreenModal open={open} onOpenChange={(o) => { if (!o) handleClose(); }}>
      <div
        role="dialog"
        aria-label={`Void order ${orderNumber}`}
        className="flex flex-col items-center justify-center min-h-screen bg-bg-base p-6"
      >
        <div className="w-full max-w-md space-y-6 rounded-lg border border-red-400/30 bg-bg-elevated p-8">
          <div className="flex items-center justify-between">
            <div>
              <div className="text-xs uppercase tracking-widest text-red-400">Void Order</div>
              <div className="font-serif text-xl text-text-primary mt-1">{orderNumber}</div>
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
              onChange={(e) => setReason(e.target.value)}
              placeholder="e.g. wrong order, customer cancelled…"
              className={cn('w-full', reason.trim().length > 0 && reason.trim().length < 3 && 'border-red-400')}
              disabled={isPending}
            />
            {reason.length > 0 && reason.trim().length < 3 && (
              <div className="mt-1 text-xs text-red-400">Reason must be at least 3 characters</div>
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
