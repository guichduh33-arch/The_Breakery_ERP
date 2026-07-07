// apps/backoffice/src/features/accounting/pages/TrialBalancePage.tsx
// Session 26b / Wave 4 — Trial Balance page.

import { useState, type JSX } from 'react';
import { Button, Input } from '@breakery/ui';
import { Download } from 'lucide-react';
import {
  useTrialBalance,
} from '@/features/accounting/hooks/useTrialBalance.js';
import { downloadTrialBalanceCsv } from '@/features/accounting/components/exportTrialBalanceCsv.js';

const CLASS_LABELS: Record<number, string> = {
  1: 'Asset', 2: 'Liability', 3: 'Equity', 4: 'Revenue', 5: 'COGS', 6: 'Expense',
};

function fmt(n: number): string {
  return new Intl.NumberFormat('id-ID').format(n);
}
function defaultPeriodStart(): string {
  const d = new Date();
  return new Date(d.getFullYear(), d.getMonth(), 1).toISOString().slice(0, 10);
}
function defaultPeriodEnd(): string {
  return new Date().toISOString().slice(0, 10);
}

export default function TrialBalancePage(): JSX.Element {
  const [startDate, setStartDate] = useState(defaultPeriodStart());
  const [endDate,   setEndDate]   = useState(defaultPeriodEnd());
  const tb = useTrialBalance(startDate, endDate);

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="font-display text-2xl text-text-primary">Trial Balance</h1>
          <p className="text-sm text-text-secondary italic">
            Asserts Σ debit = Σ credit across active accounts
          </p>
        </div>
        {tb.data && (
          <Button
            variant="secondary"
            onClick={() => downloadTrialBalanceCsv(tb.data)}
            className="inline-flex items-center gap-2"
            data-testid="tb-csv-export"
          >
            <Download className="h-4 w-4" aria-hidden />
            Export CSV
          </Button>
        )}
      </div>

      <div className="flex flex-wrap items-end gap-3">
        <label className="flex flex-col text-xs uppercase tracking-widest text-text-secondary">
          From
          <Input
            type="date" value={startDate}
            onChange={(e) => setStartDate(e.target.value)}
            className="mt-1"
            data-testid="tb-filter-start"
          />
        </label>
        <label className="flex flex-col text-xs uppercase tracking-widest text-text-secondary">
          To
          <Input
            type="date" value={endDate}
            onChange={(e) => setEndDate(e.target.value)}
            className="mt-1"
            data-testid="tb-filter-end"
          />
        </label>
      </div>

      {tb.isLoading && <p className="text-sm text-text-secondary">Loading…</p>}

      {tb.data && (
        <>
          <div data-testid="tb-balanced-badge">
            {tb.data.balanced ? (
              <span className="inline-flex items-center gap-2 rounded-full bg-success-soft px-3 py-1 text-xs font-semibold text-success">
                ✓ Balanced
              </span>
            ) : (
              <span className="inline-flex items-center gap-2 rounded-full bg-red-soft px-3 py-1 text-xs font-semibold text-red">
                ✗ Unbalanced — Δ {fmt(Math.abs(tb.data.delta))}
              </span>
            )}
          </div>

          <div className="rounded-lg border border-border-subtle bg-bg-elevated overflow-hidden">
            <table className="w-full text-sm" data-testid="tb-table">
              <thead>
                <tr className="text-left text-xs uppercase tracking-widest text-text-secondary">
                  <th className="px-3 py-2">Code</th>
                  <th className="px-3 py-2">Name</th>
                  <th className="px-3 py-2">Class</th>
                  <th className="px-3 py-2 text-right">Debit</th>
                  <th className="px-3 py-2 text-right">Credit</th>
                  <th className="px-3 py-2 text-right">Balance</th>
                </tr>
              </thead>
              <tbody>
                {tb.data.lines.map((line) => (
                  <tr
                    key={line.account_id}
                    data-testid={`tb-row-${line.code}`}
                    className="border-t border-border-subtle"
                  >
                    <td className="px-3 py-2 font-mono text-xs">{line.code}</td>
                    <td className="px-3 py-2">{line.name}</td>
                    <td className="px-3 py-2 text-xs text-text-secondary">
                      {CLASS_LABELS[line.account_class] ?? line.account_class}
                    </td>
                    <td className="px-3 py-2 text-right font-mono">{fmt(line.total_debit)}</td>
                    <td className="px-3 py-2 text-right font-mono">{fmt(line.total_credit)}</td>
                    <td className="px-3 py-2 text-right font-mono">{fmt(line.balance)}</td>
                  </tr>
                ))}
                <tr className="border-t-2 border-border-strong font-semibold">
                  <td colSpan={3} className="px-3 py-2 text-right">Total</td>
                  <td className="px-3 py-2 text-right font-mono">{fmt(tb.data.total_debit)}</td>
                  <td className="px-3 py-2 text-right font-mono">{fmt(tb.data.total_credit)}</td>
                  <td className="px-3 py-2"></td>
                </tr>
              </tbody>
            </table>
          </div>
        </>
      )}

      {!tb.isLoading && tb.data?.lines.length === 0 && (
        <p className="text-sm text-text-secondary">No activity in this period.</p>
      )}
    </div>
  );
}
