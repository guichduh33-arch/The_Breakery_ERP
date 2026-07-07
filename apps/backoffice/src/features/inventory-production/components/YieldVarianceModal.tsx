// apps/backoffice/src/features/inventory-production/components/YieldVarianceModal.tsx
//
// Session 15 — Phase 2.B — yield variance reason modal. Opens from
// ProductionForm when `|variance_pct| > production_yield_variance_threshold_pct`.
// Requires a reason of ≥ 5 chars before confirming, mirroring the server-side
// `variance_reason_too_short` check in record_production_v1.

import { useState, type FormEvent, type JSX } from 'react';
import {
  Button,
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from '@breakery/ui';

export interface YieldVarianceModalProps {
  expectedQty:  number;
  actualQty:    number;
  /** Threshold expressed as a percentage (e.g. 15 means 15%). */
  thresholdPct: number;
  onCancel:     () => void;
  onConfirm:    (reason: string) => void;
}

const MIN_REASON_LEN = 5;

export function YieldVarianceModal({
  expectedQty, actualQty, thresholdPct, onCancel, onConfirm,
}: YieldVarianceModalProps): JSX.Element {
  const [reason, setReason] = useState('');

  const variancePct = expectedQty === 0
    ? 0
    : ((actualQty - expectedQty) / expectedQty) * 100;
  const absVariance = Math.abs(variancePct);

  const trimmed = reason.trim();
  const canConfirm = trimmed.length >= MIN_REASON_LEN;

  function handleSubmit(e: FormEvent): void {
    e.preventDefault();
    if (!canConfirm) return;
    onConfirm(trimmed);
  }

  return (
    <Dialog open onOpenChange={(o) => { if (!o) onCancel(); }}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>Yield variance exceeds threshold</DialogTitle>
          <DialogDescription>
            Actual yield differs from expected by more than the configured
            tolerance. Please document why.
          </DialogDescription>
        </DialogHeader>

        <div
          className="grid grid-cols-2 gap-2 rounded-md border border-border-subtle bg-bg-elevated p-3 text-sm"
          aria-label="Yield variance summary"
        >
          <div className="space-y-0.5">
            <div className="text-xs uppercase tracking-widest text-text-secondary">Expected</div>
            <div className="font-mono">{expectedQty.toLocaleString()}</div>
          </div>
          <div className="space-y-0.5">
            <div className="text-xs uppercase tracking-widest text-text-secondary">Actual</div>
            <div className="font-mono">{actualQty.toLocaleString()}</div>
          </div>
          <div className="space-y-0.5">
            <div className="text-xs uppercase tracking-widest text-text-secondary">Variance</div>
            <div
              data-testid="variance-pct"
              className={`font-mono font-semibold ${absVariance > thresholdPct ? 'text-danger' : 'text-warning'}`}
            >
              {variancePct > 0 ? '+' : ''}{variancePct.toFixed(1)}%
            </div>
          </div>
          <div className="space-y-0.5">
            <div className="text-xs uppercase tracking-widest text-text-secondary">Threshold</div>
            <div className="font-mono">±{thresholdPct.toFixed(1)}%</div>
          </div>
        </div>

        <form onSubmit={handleSubmit} className="space-y-3 pt-2">
          <div className="space-y-1">
            <label htmlFor="yield-variance-reason" className="text-xs uppercase tracking-widest text-text-secondary">
              Reason (min {MIN_REASON_LEN} chars)
            </label>
            <textarea
              id="yield-variance-reason"
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              maxLength={500}
              rows={3}
              autoFocus
              className="w-full rounded-md border border-border-subtle bg-bg-input px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-gold"
              aria-invalid={!canConfirm}
            />
            <div className="text-xs text-text-secondary">
              {trimmed.length} / {MIN_REASON_LEN}+ chars
            </div>
          </div>

          <DialogFooter>
            <Button type="button" variant="ghost" onClick={onCancel}>
              Cancel
            </Button>
            <Button type="submit" variant="primary" disabled={!canConfirm}>
              Confirm with reason
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

export default YieldVarianceModal;
