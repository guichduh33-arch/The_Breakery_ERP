// apps/backoffice/src/features/inventory-transfers/components/TransferCancelConfirm.tsx
//
// Session 12 — Phase 3 — destructive confirmation dialog that calls
// `cancel_internal_transfer_v1`. Requires a >=3-char reason so the audit
// log captures intent. Server is authoritative on status guard.

import { useEffect, useId, useState, type FormEvent, type JSX } from 'react';
import { Button, Dialog, DialogContent, DialogTitle, DialogDescription } from '@breakery/ui';
import {
  useCancelTransfer,
  CancelTransferError,
} from '../hooks/useCancelTransfer.js';

const REASON_MIN = 3;
const REASON_MAX = 500;

export interface TransferCancelConfirmProps {
  open:            boolean;
  onClose:         () => void;
  transferId:      string;
  transferNumber:  string;
  onCancelled?:    () => void;
}

export function TransferCancelConfirm({
  open,
  onClose,
  transferId,
  transferNumber,
  onCancelled,
}: TransferCancelConfirmProps): JSX.Element {
  const cancelMut = useCancelTransfer();
  const reactId   = useId();
  const reasonId  = `${reactId}-reason`;
  const errorId   = `${reactId}-error`;

  const [reason,    setReason   ] = useState<string>('');
  const [formError, setFormError] = useState<string | null>(null);

  // Reset every time we open.
  useEffect(() => {
    if (open) {
      setReason('');
      setFormError(null);
    }
  }, [open]);

  const trimmed = reason.trim();
  const isReasonValid = trimmed.length >= REASON_MIN && trimmed.length <= REASON_MAX;
  const canSubmit = isReasonValid && !cancelMut.isPending;

  function close(): void {
    setFormError(null);
    onClose();
  }

  async function handleSubmit(e: FormEvent): Promise<void> {
    e.preventDefault();
    if (!canSubmit) return;
    setFormError(null);
    try {
      await cancelMut.mutateAsync({ transferId, reason: trimmed });
      onCancelled?.();
      close();
    } catch (err) {
      if (err instanceof CancelTransferError) {
        switch (err.code) {
          case 'forbidden':
            setFormError('You no longer have permission to cancel transfers. Please refresh.');
            break;
          case 'transfer_not_found':
            setFormError('This transfer is no longer available.');
            break;
          case 'reason_required':
            setFormError('A cancellation reason of at least 3 characters is required.');
            break;
          case 'cancel_not_allowed_in_status':
            setFormError('This transfer can no longer be cancelled. Its status has changed.');
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
      <DialogContent className="max-w-md">
        <DialogTitle>Cancel transfer {transferNumber}</DialogTitle>
        <DialogDescription>
          The transfer header will be marked as cancelled and an entry written to the audit log.
          This cannot be undone.
        </DialogDescription>

        <form onSubmit={(e) => { void handleSubmit(e); }} noValidate className="space-y-4">
          {formError !== null && (
            <div id={errorId} role="alert" className="rounded-md border border-red bg-red/5 p-2 text-xs text-red">
              {formError}
            </div>
          )}

          <div className="space-y-1">
            <label htmlFor={reasonId} className="text-xs uppercase tracking-widest text-text-secondary">
              Cancellation reason
            </label>
            <textarea
              id={reasonId}
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              rows={3}
              maxLength={REASON_MAX}
              required
              aria-invalid={reason !== '' && !isReasonValid}
              className="w-full rounded-md border border-border-subtle bg-bg-input p-2 text-sm text-text-primary focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-gold"
              placeholder="Why are you cancelling this transfer?"
            />
            <p className="text-text-secondary text-[10px]">
              {trimmed.length}/{REASON_MAX} · minimum {REASON_MIN} characters
            </p>
          </div>

          <div className="flex justify-end gap-2 pt-2">
            <Button type="button" variant="ghost" onClick={close} disabled={cancelMut.isPending}>
              Keep transfer
            </Button>
            <Button type="submit" variant="ghostDestructive" disabled={!canSubmit}>
              {cancelMut.isPending ? 'Cancelling…' : 'Cancel transfer'}
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}
