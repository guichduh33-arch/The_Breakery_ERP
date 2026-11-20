// apps/backoffice/src/features/purchasing/components/CancelReceiptDialog.tsx
//
// S3-05 — confirmation de l'annulation d'une réception, raison obligatoire.
// Même ossature que `CancelDialog` (Dialog Radix du kit, textarea à compteur).

import { useId, useState, type JSX } from 'react';
import { FOCUS_RING } from '@/components/focusRing.js';
import { Dialog, DialogDescription } from '@breakery/ui';
import { Button, DialogContent, DialogFooter, DialogHeader, DialogTitle } from '@/components/BackofficeUi.js';

export interface CancelReceiptDialogProps {
  grnNumber:   string;
  /** Bon payé au comptant : la réception porte son paiement, le serveur refusera. */
  cashTerms:   boolean;
  onCancel:    () => void;
  onConfirm:   (reason: string) => Promise<void>;
  submitting?: boolean;
  error?:      string;
}

export function CancelReceiptDialog({
  grnNumber, cashTerms, onCancel, onConfirm, submitting = false, error,
}: CancelReceiptDialogProps): JSX.Element {
  const reactId = useId();
  const [reason, setReason] = useState<string>('');
  const canSubmit = reason.trim().length >= 3 && !submitting;

  async function handleConfirm(): Promise<void> {
    if (!canSubmit) return;
    await onConfirm(reason.trim());
  }

  return (
    <Dialog open onOpenChange={(o) => { if (!o && !submitting) onCancel(); }}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>Cancel receipt</DialogTitle>
          <DialogDescription>
            Receipt {grnNumber} — the received stock is removed at the cost it entered,
            the order quantities and status go back, and a reversal entry is posted
            today. This cannot be undone. It is not a supplier return.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-3">
          <p className="text-sm text-text-secondary">
            {cashTerms
              ? 'This order is paid on delivery: the payment recorded at reception blocks the cancellation until it is settled with the supplier.'
              : 'If payments already recorded on this order exceed what would remain received, settle them with the supplier first.'}
          </p>
          <div className="space-y-1">
            <label htmlFor={`${reactId}-reason`} className="font-data font-semibold text-xs uppercase tracking-widest text-text-secondary">
              Reason
            </label>
            <textarea
              id={`${reactId}-reason`}
              value={reason}
              onChange={(e) => setReason(e.target.value.slice(0, 200))}
              disabled={submitting}
              rows={3}
              maxLength={200}
              className={`w-full rounded-md border border-border-strong bg-bg-input px-3 py-2 text-sm text-text-primary ${FOCUS_RING}`}
              aria-required="true"
              aria-describedby={`${reactId}-hint`}
            />
            <div className="flex justify-between text-xs text-text-secondary">
              <span id={`${reactId}-hint`}>At least 3 characters.</span>
              <span>{reason.length}/200</span>
            </div>
          </div>
          {error !== undefined && error !== '' && (
            <div role="alert" className="rounded-md border border-danger bg-danger-soft px-3 py-2 text-sm text-danger">
              {error}
            </div>
          )}
        </div>

        <DialogFooter>
          <Button type="button" variant="ghost" onClick={onCancel} disabled={submitting}>Keep receipt</Button>
          <Button
            type="button"
            variant="ghostDestructive"
            onClick={() => { void handleConfirm(); }}
            disabled={!canSubmit}
          >
            {submitting ? 'Cancelling…' : 'Cancel receipt'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
