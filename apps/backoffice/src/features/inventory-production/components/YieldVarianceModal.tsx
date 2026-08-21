// apps/backoffice/src/features/inventory-production/components/YieldVarianceModal.tsx
//
// Session 15 — Phase 2.B — yield variance reason modal. Opens from
// ProductionForm when `|variance_pct| > production_yield_variance_threshold_pct`.
// Requires a reason of ≥ 5 chars before confirming, mirroring the server-side
// `variance_reason_too_short` check in record_production_v5.

import { useState, type FormEvent, type JSX } from 'react';
import {
  Button,
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from '@breakery/ui';
import { formatPercent, formatQuantity } from '@breakery/utils';
import { FOCUS_RING } from '@/components/focusRing.js';

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
            <div className="font-mono">{formatQuantity(expectedQty, null)}</div>
          </div>
          <div className="space-y-0.5">
            <div className="text-xs uppercase tracking-widest text-text-secondary">Actual</div>
            <div className="font-mono">{formatQuantity(actualQty, null)}</div>
          </div>
          <div className="space-y-0.5">
            <div className="text-xs uppercase tracking-widest text-text-secondary">Variance</div>
            <div
              data-testid="variance-pct"
              className={`font-mono font-semibold ${absVariance > thresholdPct ? 'text-danger' : 'text-warning'}`}
            >
              {formatPercent(variancePct, { signed: true })}
            </div>
          </div>
          <div className="space-y-0.5">
            <div className="text-xs uppercase tracking-widest text-text-secondary">Threshold</div>
            <div className="font-mono">±{formatPercent(thresholdPct)}</div>
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
              // `focus:ring-2` était keyé sur `:focus` et non `:focus-visible`.
              // Sur un `<textarea autoFocus>` c'est le pire cas : l'anneau
              // s'allumait à la seule OUVERTURE de la modale, avant toute
              // interaction clavier. La doctrine maison est un `outline`
              // (FOCUS_RING), pas un `ring` (box-shadow).
              className={`w-full rounded-md border border-border-strong bg-bg-input px-3 py-2 text-sm ${FOCUS_RING}`}
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
            <Button type="submit" variant="ink" disabled={!canConfirm}>
              Confirm with reason
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

export default YieldVarianceModal;
