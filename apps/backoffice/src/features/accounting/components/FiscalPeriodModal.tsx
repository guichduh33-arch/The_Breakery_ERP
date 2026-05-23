// apps/backoffice/src/features/accounting/components/FiscalPeriodModal.tsx
// Session 26b / Wave 5 — Close (or lock) a fiscal period.
//   Step 1 : period selector + "lock backdating" checkbox + summary
//   Step 2 : PIN entry + confirm.
//   Gate : permission accounting.period.close (enforced by RPC).

import { useState, type JSX } from 'react';
import {
  Button, Input,
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter,
} from '@breakery/ui';
import { useFiscalPeriods, type FiscalPeriodRow } from '../hooks/useFiscalPeriods.js';
import { useCloseFiscalPeriod } from '../hooks/useCloseFiscalPeriod.js';

export interface FiscalPeriodModalProps {
  onClose: () => void;
  /** Optionally pre-select a period (passed from list). */
  initialPeriodId?: string;
}

export function FiscalPeriodModal({
  onClose, initialPeriodId,
}: FiscalPeriodModalProps): JSX.Element {
  const periods = useFiscalPeriods();
  const closePeriod = useCloseFiscalPeriod();

  const [step, setStep]           = useState<1 | 2>(1);
  const [periodId, setPeriodId]   = useState<string>(initialPeriodId ?? '');
  const [lock, setLock]           = useState(false);
  const [pin, setPin]             = useState('');
  const [error, setError]         = useState<string | null>(null);

  const openable: FiscalPeriodRow[] = (periods.data ?? []).filter(
    (p) => p.status === 'open' || (p.status === 'closed' && true /* allow re-lock */),
  );
  const selectedPeriod = (periods.data ?? []).find((p) => p.id === periodId) ?? null;

  function handleNext() {
    setError(null);
    if (periodId === '') {
      setError('Pick a period.');
      return;
    }
    if (selectedPeriod?.status === 'locked') {
      setError('This period is already locked.');
      return;
    }
    if (selectedPeriod?.status === 'closed' && !lock) {
      setError('This period is already closed. Tick "lock" to lock it.');
      return;
    }
    setStep(2);
  }

  function handleSubmit() {
    setError(null);
    if (pin.length !== 6 || !/^\d{6}$/.test(pin)) {
      setError('PIN must be exactly 6 digits.');
      return;
    }
    closePeriod.mutate(
      { periodId, managerPin: pin, lock },
      {
        onSuccess: () => onClose(),
        onError:   (e) => setError(e.message),
      },
    );
  }

  return (
    <Dialog open={true} onOpenChange={(o) => { if (!o) onClose(); }}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>{lock ? 'Lock' : 'Close'} fiscal period</DialogTitle>
          <DialogDescription>Step {step} of 2</DialogDescription>
        </DialogHeader>

        {step === 1 && (
          <div className="space-y-4">
            <label className="flex flex-col text-sm">
              Period
              <select
                value={periodId}
                onChange={(e) => setPeriodId(e.target.value)}
                className="mt-1 rounded-md border border-border-subtle bg-bg-elevated px-3 py-2 text-sm"
                data-testid="fp-modal-period-select"
              >
                <option value="">— select a period —</option>
                {openable.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.period_start} — {p.period_end} ({p.status})
                  </option>
                ))}
              </select>
            </label>

            <label className="flex items-start gap-2 text-sm">
              <input
                type="checkbox"
                checked={lock}
                onChange={(e) => setLock(e.target.checked)}
                className="mt-1"
                data-testid="fp-modal-lock-checkbox"
              />
              <div>
                <div className="font-semibold">Lock (no backdating)</div>
                <div className="text-xs text-text-secondary">
                  Once locked, no JE can be inserted with entry_date in this period —
                  even by admins. Use to seal a closed accounting period.
                </div>
              </div>
            </label>

            {selectedPeriod && (
              <div className="rounded border border-border-subtle bg-bg-overlay px-3 py-2 text-xs">
                <div>Period : {selectedPeriod.period_start} → {selectedPeriod.period_end}</div>
                <div>Current status : <span className="font-mono">{selectedPeriod.status}</span></div>
                <div>New status : <span className="font-mono">{lock ? 'locked' : 'closed'}</span></div>
              </div>
            )}
          </div>
        )}

        {step === 2 && (
          <div className="space-y-4">
            <div className="rounded border border-amber-300 bg-amber-50 px-3 py-2 text-xs text-amber-900">
              You are about to <strong>{lock ? 'LOCK' : 'CLOSE'}</strong> period{' '}
              <strong>{selectedPeriod?.period_start} → {selectedPeriod?.period_end}</strong>.
              This action is audit-logged and cannot be undone via UI.
            </div>
            <label className="flex flex-col text-sm">
              Manager PIN (6 digits)
              <Input
                type="password"
                inputMode="numeric"
                maxLength={6}
                value={pin}
                onChange={(e) => setPin(e.target.value.replace(/\D/g, '').slice(0, 6))}
                data-testid="fp-modal-pin"
              />
            </label>
          </div>
        )}

        {error !== null && (
          <div
            role="alert"
            className="rounded border border-red bg-red-soft px-3 py-2 text-sm text-red"
            data-testid="fp-modal-error"
          >
            {error}
          </div>
        )}

        <DialogFooter>
          <Button variant="secondary" onClick={onClose} disabled={closePeriod.isPending}>
            Cancel
          </Button>
          {step === 1 && (
            <Button onClick={handleNext} data-testid="fp-modal-next">Next →</Button>
          )}
          {step === 2 && (
            <>
              <Button variant="ghost" onClick={() => setStep(1)} disabled={closePeriod.isPending}>
                ← Back
              </Button>
              <Button
                onClick={handleSubmit}
                disabled={closePeriod.isPending}
                data-testid="fp-modal-submit"
              >
                {closePeriod.isPending ? 'Submitting…' : 'Confirm'}
              </Button>
            </>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
