// apps/backoffice/src/features/accounting/pages/PB1ManagementPage.tsx
// Session 26c / Wave 1 — PB1 declaration helper (NON-PKP, PEMDA Bali 10%).
// Read-only report consuming calculate_pb1_payable_v1.

import { useState, type JSX } from 'react';
import { Button, Input } from '@breakery/ui';
import { Printer } from 'lucide-react';
import { usePb1Payable } from '@/features/accounting/hooks/usePb1Payable.js';

function fmt(n: number): string {
  return new Intl.NumberFormat('id-ID').format(n);
}
function defaultPeriodStart(): string {
  const d = new Date();
  return new Date(d.getFullYear(), d.getMonth(), 1).toISOString().slice(0, 10);
}
function defaultPeriodEnd(): string {
  const d = new Date();
  return new Date(d.getFullYear(), d.getMonth() + 1, 0).toISOString().slice(0, 10);
}

export default function PB1ManagementPage(): JSX.Element {
  const [startDate, setStartDate] = useState(defaultPeriodStart());
  const [endDate,   setEndDate]   = useState(defaultPeriodEnd());
  const pb1 = usePb1Payable(startDate, endDate);

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="font-display text-2xl text-text-primary">PB1 Management</h1>
          <p className="text-sm text-text-secondary italic">
            Helper for monthly PB1 declaration (NON-PKP, payable to PEMDA Bali)
          </p>
        </div>
        {pb1.data && (
          <Button
            variant="secondary"
            onClick={() => window.print()}
            className="inline-flex items-center gap-2"
            data-testid="pb1-print"
          >
            <Printer className="h-4 w-4" aria-hidden />
            Print
          </Button>
        )}
      </div>

      <div className="flex flex-wrap items-end gap-3">
        <label className="flex flex-col text-xs uppercase tracking-widest text-text-secondary">
          Period start
          <Input
            type="date" value={startDate}
            onChange={(e) => setStartDate(e.target.value)}
            className="mt-1"
            data-testid="pb1-filter-start"
          />
        </label>
        <label className="flex flex-col text-xs uppercase tracking-widest text-text-secondary">
          Period end
          <Input
            type="date" value={endDate}
            onChange={(e) => setEndDate(e.target.value)}
            className="mt-1"
            data-testid="pb1-filter-end"
          />
        </label>
      </div>

      {pb1.isLoading && <p className="text-sm text-text-secondary">Loading…</p>}

      {pb1.data && (
        <div
          className="rounded-lg border border-border-subtle bg-bg-elevated p-6 space-y-4"
          data-testid="pb1-summary-card"
        >
          <div className="grid gap-4 sm:grid-cols-2">
            <div>
              <div className="text-xs uppercase tracking-widest text-text-secondary">
                Period
              </div>
              <div className="mt-1 font-mono text-lg" data-testid="pb1-period">
                {pb1.data.period_start} → {pb1.data.period_end}
              </div>
            </div>
            <div>
              <div className="text-xs uppercase tracking-widest text-text-secondary">
                Tax regime
              </div>
              <div className="mt-1 font-mono text-lg" data-testid="pb1-regime">
                {pb1.data.tax_regime} ({(pb1.data.tax_rate * 100).toFixed(1)}%)
              </div>
            </div>
          </div>

          <div className="grid gap-4 sm:grid-cols-2 border-t border-border-subtle pt-4">
            <div>
              <div className="text-xs uppercase tracking-widest text-text-secondary">
                PB1 output collected
              </div>
              <div className="mt-1 font-mono text-2xl" data-testid="pb1-output">
                Rp {fmt(pb1.data.pb1_output)}
              </div>
            </div>
            <div>
              <div className="text-xs uppercase tracking-widest text-text-secondary">
                PB1 payable to PEMDA Bali
              </div>
              <div className="mt-1 font-mono text-2xl text-gold" data-testid="pb1-payable">
                Rp {fmt(pb1.data.pb1_payable)}
              </div>
            </div>
          </div>

          <div className="text-xs text-text-secondary italic border-t border-border-subtle pt-3">
            {pb1.data.note}
          </div>
        </div>
      )}
    </div>
  );
}
