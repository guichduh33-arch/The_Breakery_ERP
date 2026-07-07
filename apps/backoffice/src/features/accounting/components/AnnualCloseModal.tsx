// apps/backoffice/src/features/accounting/components/AnnualCloseModal.tsx
// Session 56 — DEV-S54-01 : annual fiscal-year close (close_fiscal_year_v1).
//   Step 1 : year selector (derived from fiscal_periods) + preconditions info
//   Step 2 : PIN entry + irreversible warning
//   Done   : recap (entry number, net result carried to 3200, N+1 seeded)

import { useMemo, useState, type JSX } from 'react';
import {
  Button, Input, Select,
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter,
} from '@breakery/ui';
import { formatIdr } from '@breakery/utils';
import { useFiscalPeriods } from '../hooks/useFiscalPeriods.js';
import {
  useCloseFiscalYear,
  CloseFiscalYearError,
  type CloseFiscalYearResult,
} from '../hooks/useCloseFiscalYear.js';

const ERROR_COPY: Record<string, string> = {
  fiscal_year_invalid:       'Invalid fiscal year.',
  pin_required:              'PIN must be exactly 6 digits.',
  forbidden:                 'You do not have permission to close a fiscal year (needs accounting.year.close).',
  invalid_pin:               'Invalid manager PIN.',
  periods_missing:           'Not all 12 periods of this year exist — seed the fiscal calendar first.',
  periods_open:              'Some periods of this year are still open — close or lock all 12 periods first.',
  year_already_closed:       'This fiscal year is already closed.',
  retained_earnings_missing: 'Retained Earnings account (3200) is missing or inactive.',
  unknown:                   'Something went wrong. Please retry.',
};

export function AnnualCloseModal({ onClose }: { onClose: () => void }): JSX.Element {
  const periods = useFiscalPeriods();
  const closeYear = useCloseFiscalYear();

  const [step, setStep]     = useState<1 | 2>(1);
  const [year, setYear]     = useState<string>('');
  const [pin, setPin]       = useState('');
  const [error, setError]   = useState<string | null>(null);
  const [result, setResult] = useState<CloseFiscalYearResult | null>(null);

  // Distinct years with closed/locked counts (period_start is 'YYYY-MM-DD').
  const yearStats = useMemo(() => {
    const map = new Map<number, { total: number; sealed: number }>();
    for (const p of periods.data ?? []) {
      const y = Number(p.period_start.slice(0, 4));
      const s = map.get(y) ?? { total: 0, sealed: 0 };
      s.total += 1;
      if (p.status === 'closed' || p.status === 'locked') s.sealed += 1;
      map.set(y, s);
    }
    return [...map.entries()].sort((a, b) => a[0] - b[0]);
  }, [periods.data]);

  function handleNext() {
    setError(null);
    if (year === '') { setError('Pick a fiscal year.'); return; }
    setStep(2);
  }

  function handleSubmit() {
    setError(null);
    if (pin.length !== 6 || !/^\d{6}$/.test(pin)) {
      setError('PIN must be exactly 6 digits.');
      return;
    }
    closeYear.mutate(
      { fiscalYear: Number(year), managerPin: pin },
      {
        onSuccess: (r) => setResult(r),
        onError:   (e) => setError(
          e instanceof CloseFiscalYearError
            ? (ERROR_COPY[e.code] ?? e.message)
            : ERROR_COPY.unknown!,
        ),
      },
    );
  }

  return (
    <Dialog open={true} onOpenChange={(o) => { if (!o && !closeYear.isPending) onClose(); }}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>Annual close</DialogTitle>
          <DialogDescription>
            {result !== null ? 'Done' : `Step ${step} of 2`}
          </DialogDescription>
        </DialogHeader>

        {result !== null && (
          <div className="space-y-3" data-testid="ac-modal-success">
            {result.je_id === null ? (
              <div className="rounded border border-border-subtle bg-bg-overlay px-3 py-2 text-sm">
                No class 4/5/6 activity in {result.fiscal_year} — nothing to carry
                forward. The {result.periods_seeded_next_year} periods of{' '}
                {result.fiscal_year + 1} were seeded.
              </div>
            ) : (
              <div className="rounded border border-border-subtle bg-bg-overlay px-3 py-2 text-sm space-y-1">
                <div>
                  {result.net_result >= 0 ? 'Profit carried forward' : 'Loss carried forward'}{' '}
                  to <span className="font-mono">3200 Retained Earnings</span> :{' '}
                  <span className="font-mono">{formatIdr(Math.abs(result.net_result))}</span>
                </div>
                <div className="text-xs text-text-secondary">
                  Journal entry <span className="font-mono">{result.entry_number}</span>
                  {' • '}{result.periods_seeded_next_year} periods of {result.fiscal_year + 1} seeded
                </div>
              </div>
            )}
          </div>
        )}

        {result === null && step === 1 && (
          <div className="space-y-4">
            <label className="flex flex-col text-sm">
              Fiscal year
              <Select
                value={year}
                onChange={(e) => setYear(e.target.value)}
                className="mt-1"
                data-testid="ac-modal-year-select"
              >
                <option value="">— select a year —</option>
                {yearStats.map(([y, s]) => (
                  <option key={y} value={String(y)}>
                    {y} ({s.sealed}/{s.total} periods closed or locked)
                  </option>
                ))}
              </Select>
            </label>
            <div className="rounded border border-border-subtle bg-bg-overlay px-3 py-2 text-xs space-y-1">
              <div>Preconditions : all 12 periods of the year closed or locked, and no prior annual close.</div>
              <div>Effect : classes 4/5/6 are zeroed into <span className="font-mono">3200 Retained Earnings</span> (JE dated Dec 31) and the 12 periods of the next year are seeded.</div>
            </div>
          </div>
        )}

        {result === null && step === 2 && (
          <div className="space-y-4">
            <div className="rounded border border-warning/30 bg-warning-soft px-3 py-2 text-xs text-warning">
              You are about to <strong>CLOSE fiscal year {year}</strong>. This posts a
              year-close journal entry and cannot be undone via UI.
            </div>
            <label className="flex flex-col text-sm">
              Manager PIN (6 digits)
              <Input
                type="password"
                inputMode="numeric"
                maxLength={6}
                value={pin}
                onChange={(e) => setPin(e.target.value.replace(/\D/g, '').slice(0, 6))}
                data-testid="ac-modal-pin"
              />
            </label>
          </div>
        )}

        {error !== null && (
          <div
            role="alert"
            className="rounded border border-red bg-red-soft px-3 py-2 text-sm text-red"
            data-testid="ac-modal-error"
          >
            {error}
          </div>
        )}

        <DialogFooter>
          <Button variant="secondary" onClick={onClose} disabled={closeYear.isPending}>
            {result !== null ? 'Close' : 'Cancel'}
          </Button>
          {result === null && step === 1 && (
            <Button onClick={handleNext} data-testid="ac-modal-next">Next →</Button>
          )}
          {result === null && step === 2 && (
            <>
              <Button variant="ghost" onClick={() => setStep(1)} disabled={closeYear.isPending}>
                ← Back
              </Button>
              <Button
                onClick={handleSubmit}
                disabled={closeYear.isPending}
                data-testid="ac-modal-submit"
              >
                {closeYear.isPending ? 'Closing…' : 'Confirm annual close'}
              </Button>
            </>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
