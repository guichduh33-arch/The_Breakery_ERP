// apps/backoffice/src/features/btob/components/AdjustB2bBalanceModal.tsx
//
// S76 — inventaire ⚫ #13 : ajustement manuel d'encours B2B (JE + PIN manager).
// Mirrors the RecordB2bPaymentModal structure (single-screen Dialog form,
// useId-scoped labels, inline alert on error).

import { useId, useState, type JSX } from 'react';
import {
  Button,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogTitle,
  Input,
} from '@breakery/ui';
import { useAdjustB2bBalance } from '../hooks/useAdjustB2bBalance.js';

export interface AdjustB2bBalanceModalProps {
  customerId:   string;
  customerName: string;
  open:         boolean;
  onClose:      () => void;
}

export function AdjustB2bBalanceModal({
  customerId, customerName, open, onClose,
}: AdjustB2bBalanceModalProps): JSX.Element {
  const reactId  = useId();
  const deltaId  = `${reactId}-delta`;
  const reasonId = `${reactId}-reason`;
  const pinId    = `${reactId}-pin`;

  const [deltaRaw, setDeltaRaw] = useState('');
  const [reason,   setReason]   = useState('');
  const [pin,      setPin]      = useState('');
  const adjust = useAdjustB2bBalance(customerId);

  const delta = Number(deltaRaw);
  const valid = deltaRaw.trim() !== ''
    && Number.isFinite(delta)
    && delta !== 0
    && reason.trim() !== ''
    && /^\d{6}$/.test(pin);

  function handleClose(): void {
    onClose();
  }

  function submit(): void {
    if (!valid || adjust.isPending) return;
    adjust.mutate(
      { delta, reason: reason.trim(), managerPin: pin },
      {
        onSuccess: () => {
          setDeltaRaw('');
          setReason('');
          setPin('');
          onClose();
        },
      },
    );
  }

  return (
    <Dialog open={open} onOpenChange={(o) => { if (!o) handleClose(); }}>
      <DialogContent className="max-w-md">
        <DialogTitle>Adjust B2B balance — {customerName}</DialogTitle>
        <DialogDescription className="sr-only">
          Manually adjust the customer&apos;s outstanding AR balance. Requires a manager PIN and posts a journal entry.
        </DialogDescription>

        <form
          onSubmit={(e) => { e.preventDefault(); submit(); }}
          noValidate
          className="space-y-4"
        >
          {adjust.error && (
            <div role="alert" className="rounded-md border border-red bg-red/5 p-2 text-xs text-red">
              {adjust.error.message}
            </div>
          )}

          <div className="space-y-1">
            <label htmlFor={deltaId} className="text-xs uppercase tracking-widest text-text-secondary">
              Delta (IDR, negative = write-down)
            </label>
            <Input
              id={deltaId}
              type="number"
              inputMode="decimal"
              step="1"
              value={deltaRaw}
              onChange={(e) => setDeltaRaw(e.target.value)}
              aria-invalid={deltaRaw !== '' && (!Number.isFinite(delta) || delta === 0)}
            />
          </div>

          <div className="space-y-1">
            <label htmlFor={reasonId} className="text-xs uppercase tracking-widest text-text-secondary">
              Reason
            </label>
            <Input
              id={reasonId}
              type="text"
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              placeholder="Write-off, correction, manual reconciliation…"
            />
          </div>

          <div className="space-y-1">
            <label htmlFor={pinId} className="text-xs uppercase tracking-widest text-text-secondary">
              Manager PIN
            </label>
            <Input
              id={pinId}
              type="password"
              inputMode="numeric"
              maxLength={6}
              value={pin}
              onChange={(e) => setPin(e.target.value)}
            />
          </div>

          <div className="flex justify-end gap-2 pt-2">
            <Button type="button" variant="ghost" onClick={handleClose}>Cancel</Button>
            <Button type="submit" variant="primary" disabled={!valid || adjust.isPending}>
              {adjust.isPending ? 'Adjusting…' : 'Adjust balance'}
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}
