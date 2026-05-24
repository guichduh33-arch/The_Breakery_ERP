// apps/backoffice/src/features/cash-register/components/VoidZReportModal.tsx
//
// S29 Wave 6.B.2 — Modal to void a signed Z-Report. Admin-only (perm zreports.void).
// Reason field min 10 char enforced UI + DB.

import { useEffect, useState } from 'react';
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
  Button,
} from '@breakery/ui';
import { Loader2 } from 'lucide-react';
import { useVoidZReport } from '../hooks/useVoidZReport.js';

export interface VoidZReportModalProps {
  open:         boolean;
  zreportId:    string | null;
  onOpenChange: (open: boolean) => void;
  onSuccess?:   () => void;
}

export function VoidZReportModal({ open, zreportId, onOpenChange, onSuccess }: VoidZReportModalProps): JSX.Element {
  const [reason, setReason]     = useState<string>('');
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const mutation = useVoidZReport();

  useEffect(() => {
    if (!open) {
      setReason('');
      setErrorMsg(null);
      mutation.resetIdempotency();
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  const trimmed  = reason.trim();
  const validLen = trimmed.length >= 10;

  const handleVoid = async (): Promise<void> => {
    if (!zreportId) return;
    if (!validLen) {
      setErrorMsg('Reason must be at least 10 characters');
      return;
    }
    setErrorMsg(null);
    try {
      await mutation.mutateAsync({ zreportId, reason: trimmed });
      onSuccess?.();
      onOpenChange(false);
    } catch (e) {
      const msg = (e as { message?: string })?.message ?? 'Void failed';
      setErrorMsg(msg);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Void Z-Report</DialogTitle>
          <DialogDescription>
            Voiding a Z-Report does not remove the archived PDF — it marks the report as invalid in the ledger.
            Reason will be recorded.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-3">
          <div>
            <label htmlFor="void-reason" className="text-xs uppercase tracking-widest text-text-secondary block mb-1">
              Reason (min 10 characters)
            </label>
            <textarea
              id="void-reason"
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              rows={4}
              placeholder="e.g. Manager misclicked, signed wrong shift"
              className="w-full rounded-md border border-border-subtle bg-bg-input px-3 py-2 text-sm text-text-primary"
              data-testid="void-reason-input"
            />
            <p className="text-xs text-text-secondary mt-1">{trimmed.length} / 10 characters</p>
          </div>
          {errorMsg !== null && (
            <p className="text-sm text-red-500" role="alert">{errorMsg}</p>
          )}
          <DialogFooter className="pt-2">
            <Button variant="ghost" onClick={() => onOpenChange(false)} data-testid="void-cancel">Cancel</Button>
            <Button
              variant="ghostDestructive"
              onClick={() => void handleVoid()}
              disabled={!validLen || mutation.isPending}
              data-testid="void-submit"
            >
              {mutation.isPending
                ? <><Loader2 className="h-4 w-4 mr-1 animate-spin" />Voiding…</>
                : 'Void'}
            </Button>
          </DialogFooter>
        </div>
      </DialogContent>
    </Dialog>
  );
}
