// apps/backoffice/src/features/purchasing/components/CancelDialog.tsx
//
// Session 13 — Phase 3.A — Confirm cancellation of a PO with required reason.
// Phase 4.D — migrated from ad-hoc <div> overlay to @breakery/ui Radix Dialog.

import { useId, useState, type JSX } from 'react';
import {
  Button,
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from '@breakery/ui';

export interface CancelDialogProps {
  poNumber:  string;
  onCancel:  () => void;
  onConfirm: (reason: string) => Promise<void>;
  submitting?: boolean;
  error?:    string;
}

export function CancelDialog({
  poNumber, onCancel, onConfirm, submitting = false, error,
}: CancelDialogProps): JSX.Element {
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
          <DialogTitle>Cancel purchase order</DialogTitle>
          <DialogDescription>
            PO {poNumber} — cancellation is final and only allowed before any goods
            have been received.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-3">
          <div className="space-y-1">
            <label htmlFor={`${reactId}-reason`} className="text-xs uppercase tracking-widest text-text-secondary">
              Reason
            </label>
            <textarea
              id={`${reactId}-reason`}
              value={reason}
              onChange={(e) => setReason(e.target.value.slice(0, 200))}
              disabled={submitting}
              rows={3}
              maxLength={200}
              className="w-full rounded-md border border-border-subtle bg-bg-input px-3 py-2 text-sm text-text-primary"
              aria-required="true"
            />
            <div className="text-xs text-text-secondary text-right">{reason.length}/200</div>
          </div>
          {error !== undefined && error !== '' && (
            <div role="alert" className="rounded-md border border-danger/30 bg-danger-soft px-3 py-2 text-sm text-danger">
              {error}
            </div>
          )}
        </div>

        <DialogFooter>
          <Button type="button" variant="ghost" onClick={onCancel} disabled={submitting}>Keep PO</Button>
          <Button
            type="button"
            variant="ghostDestructive"
            onClick={() => { void handleConfirm(); }}
            disabled={!canSubmit}
          >
            {submitting ? 'Cancelling…' : 'Cancel PO'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
