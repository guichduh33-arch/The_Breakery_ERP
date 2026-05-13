// apps/backoffice/src/features/purchasing/components/CancelDialog.tsx
//
// Session 13 — Phase 3.A — Confirm cancellation of a PO with required reason.

import { useId, useState, type JSX } from 'react';
import { Button } from '@breakery/ui';

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
    <div className="fixed inset-0 z-50 bg-black/60 flex items-center justify-center p-4" role="dialog" aria-modal="true">
      <div className="w-full max-w-md bg-bg-elevated border border-border-subtle rounded-lg shadow-xl">
        <header className="px-4 py-3 border-b border-border-subtle">
          <h2 className="font-serif text-xl text-text-primary">Cancel purchase order</h2>
          <p className="text-xs text-text-secondary mt-0.5">PO {poNumber}</p>
        </header>
        <div className="px-4 py-4 space-y-3">
          <p className="text-sm text-text-secondary">
            Cancellation is final and only allowed before any goods have been received.
            Provide a reason for the audit log.
          </p>
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
        <footer className="px-4 py-3 border-t border-border-subtle flex justify-end gap-2">
          <Button type="button" variant="ghost" onClick={onCancel} disabled={submitting}>Keep PO</Button>
          <Button
            type="button"
            variant="ghostDestructive"
            onClick={() => { void handleConfirm(); }}
            disabled={!canSubmit}
          >
            {submitting ? 'Cancelling…' : 'Cancel PO'}
          </Button>
        </footer>
      </div>
    </div>
  );
}
