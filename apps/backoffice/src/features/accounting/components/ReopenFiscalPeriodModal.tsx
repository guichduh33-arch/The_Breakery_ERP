// apps/backoffice/src/features/accounting/components/ReopenFiscalPeriodModal.tsx
// S1-03 — rouvre une période `closed`. Le geste est réservé au propriétaire et
// confirmé par PIN ; le serveur refuse une période `locked` ou un exercice déjà
// clôturé annuellement.

import { useState, type JSX } from 'react';
import { Input, Dialog, DialogDescription } from '@breakery/ui';
import { Button, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/BackofficeUi.js';
import type { FiscalPeriodRow } from '../hooks/useFiscalPeriods.js';
import { useReopenFiscalPeriod } from '../hooks/useReopenFiscalPeriod.js';
import { fiscalPeriodLabel } from '../utils/fiscalPeriodLabel.js';

const ERROR_COPY: Record<string, string> = {
  invalid_pin:                'Invalid PIN.',
  pin_required:               'PIN must be exactly 6 digits.',
  account_locked:             'Too many wrong PINs. This account is locked for a few minutes.',
  forbidden:                  'Only the business owner can reopen a period.',
  period_not_found:           'This period no longer exists. Refresh the page.',
  period_locked_irreversible: 'This period is locked. A locked period cannot be reopened.',
  period_not_closed:          'This period is not closed. Refresh the page.',
  fiscal_year_already_closed: 'The fiscal year of this period is already closed. It cannot be reopened.',
};

function errorCopy(message: string): string {
  const code = Object.keys(ERROR_COPY).find((k) => message.includes(k));
  return code === undefined ? 'Something went wrong. Please retry.' : ERROR_COPY[code]!;
}

export interface ReopenFiscalPeriodModalProps {
  period:  FiscalPeriodRow;
  onClose: () => void;
}

export function ReopenFiscalPeriodModal({
  period, onClose,
}: ReopenFiscalPeriodModalProps): JSX.Element {
  const reopen = useReopenFiscalPeriod();
  const [pin, setPin]       = useState('');
  const [reason, setReason] = useState('');
  const [error, setError]   = useState<string | null>(null);
  const label = fiscalPeriodLabel(period.period_start, period.period_end);

  function handleSubmit() {
    setError(null);
    if (!/^\d{6}$/.test(pin)) {
      setError('PIN must be exactly 6 digits.');
      return;
    }
    reopen.mutate(
      { periodId: period.id, managerPin: pin, reason },
      {
        onSuccess: () => onClose(),
        onError:   (e) => setError(errorCopy(e.message)),
      },
    );
  }

  return (
    <Dialog open={true} onOpenChange={(o) => { if (!o) onClose(); }}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>Reopen fiscal period</DialogTitle>
          <DialogDescription>{label}</DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          <div className="rounded border border-warning bg-warning-soft px-3 py-2 text-xs text-warning">
            Reopening <strong>{label}</strong> lets journal entries be posted in
            this period again. This action is audit-logged.
          </div>

          <label className="flex flex-col text-sm">
            Reason (optional)
            <Input
              value={reason}
              maxLength={200}
              onChange={(e) => setReason(e.target.value)}
              data-testid="fp-reopen-reason"
            />
          </label>

          <label className="flex flex-col text-sm">
            Owner PIN (6 digits)
            <Input
              type="password"
              inputMode="numeric"
              maxLength={6}
              autoFocus
              value={pin}
              onChange={(e) => setPin(e.target.value.replace(/\D/g, '').slice(0, 6))}
              data-testid="fp-reopen-pin"
            />
          </label>
        </div>

        {error !== null && (
          <div
            role="alert"
            className="rounded border border-red bg-red-soft px-3 py-2 text-sm text-red"
            data-testid="fp-reopen-error"
          >
            {error}
          </div>
        )}

        <DialogFooter>
          <Button variant="secondary" onClick={onClose} disabled={reopen.isPending}>
            Cancel
          </Button>
          <Button
            variant="ink"
            onClick={handleSubmit}
            disabled={reopen.isPending}
            data-testid="fp-reopen-submit"
          >
            {reopen.isPending ? 'Submitting…' : 'Reopen period'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
