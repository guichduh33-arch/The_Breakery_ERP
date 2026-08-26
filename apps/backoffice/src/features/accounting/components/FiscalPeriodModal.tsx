// apps/backoffice/src/features/accounting/components/FiscalPeriodModal.tsx
// Session 26b / Wave 5 — Close (or lock) a fiscal period.
//   Step 1 : period selector + "lock backdating" checkbox + summary
//   Step 2 : PIN entry + confirm.
//   Gate : permission accounting.period.close (enforced by RPC).

import { useEffect, useRef, useState, type JSX } from 'react';
import {
  Button, Input, Select,
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter,
} from '@breakery/ui';
import { useFiscalPeriods, type FiscalPeriodRow } from '../hooks/useFiscalPeriods.js';
import { useCloseFiscalPeriod } from '../hooks/useCloseFiscalPeriod.js';
import { fiscalPeriodLabel } from '../utils/fiscalPeriodLabel.js';
import { FOCUS_RING } from '@/components/focusRing.js';

export interface FiscalPeriodModalProps {
  onClose: () => void;
  /** Optionally pre-select a period (passed from list). */
  initialPeriodId?: string | undefined;
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

  // « Next → » remplace tout le corps du dialogue, mais Radix laisse le focus
  // sur un bouton de pied qui a changé de sens sous les doigts : l'opérateur
  // arrivait à l'étape du PIN sans savoir qu'un champ l'attendait, et devait
  // tabuler à l'aveugle depuis le bas (WCAG 2.4.3). Le seul champ de l'étape 2
  // prend donc le focus, ce qui fait AUSSI annoncer son étiquette.
  const pinRef = useRef<HTMLInputElement | null>(null);
  useEffect(() => {
    if (step === 2) pinRef.current?.focus();
  }, [step]);

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
              <Select
                value={periodId}
                onChange={(e) => setPeriodId(e.target.value)}
                className="mt-1"
                data-testid="fp-modal-period-select"
              >
                <option value="">— select a period —</option>
                {openable.map((p) => (
                  <option key={p.id} value={p.id}>
                    {fiscalPeriodLabel(p.period_start, p.period_end)} ({p.status})
                  </option>
                ))}
              </Select>
            </label>

            {/* Le `<label>` implicite englobait le paragraphe entier : le nom
                accessible de la case devenait « Lock (no backdating) Once
                locked, no JE can be inserted… », soit deux phrases annoncées à
                chaque passage sur le contrôle. L'étiquette se réduit au nom du
                geste, l'explication est rattachée par `aria-describedby` — elle
                se lit une fois, à la demande. */}
            <div className="flex items-start gap-2 text-sm">
              <input
                id="fp-modal-lock"
                type="checkbox"
                checked={lock}
                onChange={(e) => setLock(e.target.checked)}
                className={`mt-1 ${FOCUS_RING}`}
                aria-describedby="fp-modal-lock-help"
                data-testid="fp-modal-lock-checkbox"
              />
              <div>
                <label htmlFor="fp-modal-lock" className="font-semibold">
                  Lock (no backdating)
                </label>
                <div id="fp-modal-lock-help" className="text-xs text-text-secondary">
                  Once locked, no JE can be inserted with entry_date in this period —
                  even by admins. Use to seal a closed accounting period.
                </div>
              </div>
            </div>

            {selectedPeriod && (
              <div className="rounded border border-border-subtle bg-bg-overlay px-3 py-2 text-xs">
                <div>Period: {fiscalPeriodLabel(selectedPeriod.period_start, selectedPeriod.period_end)}</div>
                <div>Current status: <span className="font-mono">{selectedPeriod.status}</span></div>
                <div>New status: <span className="font-mono">{lock ? 'locked' : 'closed'}</span></div>
              </div>
            )}
          </div>
        )}

        {step === 2 && (
          <div className="space-y-4">
            {/* `role="alert"` : cet avertissement n'existe pas au montage, il
                APPARAÎT au passage à l'étape 2 — et il annonce le geste le plus
                irréversible de l'application. Sans rôle, il ne se lit qu'en
                revenant en arrière dans le document ; avec, il est annoncé au
                moment où il paraît (WCAG 4.1.3). */}
            <div
              role="alert"
              className="rounded border border-warning bg-warning-soft px-3 py-2 text-xs text-warning"
            >
              You are about to <strong>{lock ? 'LOCK' : 'CLOSE'}</strong> period{' '}
              <strong>
                {selectedPeriod === null
                  ? '—'
                  : fiscalPeriodLabel(selectedPeriod.period_start, selectedPeriod.period_end)}
              </strong>.
              This action is audit-logged and cannot be undone via UI.
            </div>
            <label className="flex flex-col text-sm">
              Manager PIN (6 digits)
              <Input
                ref={pinRef}
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
            <Button variant="ink" onClick={handleNext} data-testid="fp-modal-next">Next →</Button>
          )}
          {step === 2 && (
            <>
              <Button variant="ghost" onClick={() => setStep(1)} disabled={closePeriod.isPending}>
                ← Back
              </Button>
              <Button
                variant="ink"
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
