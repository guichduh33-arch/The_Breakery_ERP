// apps/backoffice/src/features/accounting/pages/GeneralLedgerPage.tsx
// Session 26b / Wave 3 — General Ledger drilldown page.
// Account selector + date range picker + lines table (running_balance computed
// client-side from opening_balance) + Load more button.

import { useMemo, useState, useEffect, type JSX } from 'react';
import { useSearchParams } from 'react-router-dom';
import { Button, Input } from '@breakery/ui';
import { useChartOfAccounts } from '@/features/accounting/hooks/useChartOfAccounts.js';
import {
  useGeneralLedger,
  type GLLineRaw,
} from '@/features/accounting/hooks/useGeneralLedger.js';

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

interface AccumulatedLine extends GLLineRaw {
  running_balance: number;
}

export default function GeneralLedgerPage(): JSX.Element {
  const accounts = useChartOfAccounts();
  const [searchParams] = useSearchParams();

  // S32 — seed initial state from URL params (?account_id=&start=&end=).
  // No 2-way sync — user changes don't write URL (deferred S33+).
  const initialAccountId = searchParams.get('account_id') ?? '';
  const initialStart     = searchParams.get('start')      ?? defaultPeriodStart();
  const initialEnd       = searchParams.get('end')        ?? defaultPeriodEnd();

  const [accountId, setAccountId] = useState<string>(initialAccountId);
  const [startDate, setStartDate] = useState(initialStart);
  const [endDate,   setEndDate]   = useState(initialEnd);
  const [cursor,    setCursor]    = useState<{ last_date: string; last_id: string } | null>(null);
  const [pages,     setPages]     = useState<GLLineRaw[][]>([]);
  const [openingBalance, setOpeningBalance] = useState<number>(0);

  const gl = useGeneralLedger({ accountId: accountId || null, startDate, endDate, cursor });

  // Reset accumulator when account / period changes.
  useEffect(() => {
    setPages([]);
    setCursor(null);
  }, [accountId, startDate, endDate]);

  // Push each new page into the accumulator.
  useEffect(() => {
    if (!gl.data) return;
    setPages((prev) => {
      if (cursor === null) {
        setOpeningBalance(gl.data!.opening_balance);
        return [gl.data!.lines];
      }
      // Avoid duplicating the same page on re-render.
      const last = prev[prev.length - 1];
      if (last && last.length === gl.data!.lines.length && last[0]?.je_id === gl.data!.lines[0]?.je_id) {
        return prev;
      }
      return [...prev, gl.data!.lines];
    });
  }, [gl.data, cursor]);

  const account = useMemo(
    () => (accounts.data ?? []).find((a) => a.id === accountId) ?? null,
    [accounts.data, accountId],
  );

  const accumulated = useMemo<AccumulatedLine[]>(() => {
    if (!account) return [];
    const flat = pages.flat();
    const out: AccumulatedLine[] = [];
    let running = openingBalance;
    for (const line of flat) {
      const delta =
        account.balance_type === 'debit'
          ? (Number(line.debit) - Number(line.credit))
          : (Number(line.credit) - Number(line.debit));
      running += delta;
      out.push({ ...line, running_balance: running });
    }
    return out;
  }, [pages, openingBalance, account]);

  function handleLoadMore() {
    if (gl.data?.next_cursor) setCursor(gl.data.next_cursor);
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="font-display text-2xl text-text-primary">General Ledger</h1>
        <p className="text-sm text-text-secondary italic">
          Drilldown by account with running balance
        </p>
      </div>

      <div className="flex flex-wrap items-end gap-3">
        <label className="flex flex-col text-xs uppercase tracking-widest text-text-secondary">
          Account
          <select
            value={accountId}
            onChange={(e) => setAccountId(e.target.value)}
            className="mt-1 rounded-md border border-border-subtle bg-bg-elevated px-3 py-2 text-sm min-w-72"
            data-testid="gl-account-select"
          >
            <option value="">— select an account —</option>
            {(accounts.data ?? [])
              .filter((a) => a.is_postable && a.is_active)
              .map((a) => (
                <option key={a.id} value={a.id}>
                  {a.code} — {a.name}
                </option>
              ))}
          </select>
        </label>
        <label className="flex flex-col text-xs uppercase tracking-widest text-text-secondary">
          From
          <Input
            type="date"
            value={startDate}
            onChange={(e) => setStartDate(e.target.value)}
            className="mt-1"
            data-testid="gl-filter-start"
          />
        </label>
        <label className="flex flex-col text-xs uppercase tracking-widest text-text-secondary">
          To
          <Input
            type="date"
            value={endDate}
            onChange={(e) => setEndDate(e.target.value)}
            className="mt-1"
            data-testid="gl-filter-end"
          />
        </label>
      </div>

      {accountId === '' && (
        <p className="text-sm text-text-secondary">Pick an account to see its ledger.</p>
      )}

      {accountId !== '' && gl.isLoading && pages.length === 0 && (
        <p className="text-sm text-text-secondary">Loading ledger…</p>
      )}

      {accountId !== '' && gl.data && (
        <div className="rounded-lg border border-border-subtle bg-bg-elevated overflow-hidden">
          <table className="w-full text-sm" data-testid="gl-table">
            <thead>
              <tr className="text-left text-xs uppercase tracking-widest text-text-secondary">
                <th className="px-3 py-2">Date</th>
                <th className="px-3 py-2">Entry #</th>
                <th className="px-3 py-2">Description</th>
                <th className="px-3 py-2 text-right">Debit</th>
                <th className="px-3 py-2 text-right">Credit</th>
                <th className="px-3 py-2 text-right">Running balance</th>
              </tr>
            </thead>
            <tbody>
              <tr className="border-t border-border-subtle bg-bg-overlay font-semibold">
                <td colSpan={5} className="px-3 py-2 text-right">Opening balance</td>
                <td className="px-3 py-2 text-right font-mono">{fmt(openingBalance)}</td>
              </tr>
              {accumulated.map((line, idx) => (
                <tr
                  key={`${line.je_id}-${idx}`}
                  data-testid={`gl-row-${line.entry_number}`}
                  className="border-t border-border-subtle"
                >
                  <td className="px-3 py-2">{line.entry_date}</td>
                  <td className="px-3 py-2 font-mono text-xs">{line.entry_number}</td>
                  <td className="px-3 py-2">
                    {line.description ?? '—'}
                    {line.line_description && (
                      <span className="ml-2 text-xs text-text-secondary">{line.line_description}</span>
                    )}
                  </td>
                  <td className="px-3 py-2 text-right font-mono">
                    {Number(line.debit) > 0 ? fmt(Number(line.debit)) : ''}
                  </td>
                  <td className="px-3 py-2 text-right font-mono">
                    {Number(line.credit) > 0 ? fmt(Number(line.credit)) : ''}
                  </td>
                  <td className="px-3 py-2 text-right font-mono">{fmt(line.running_balance)}</td>
                </tr>
              ))}
              <tr className="border-t-2 border-border-strong font-semibold">
                <td colSpan={3} className="px-3 py-2 text-right">Period totals</td>
                <td className="px-3 py-2 text-right font-mono">{fmt(gl.data.total_debit)}</td>
                <td className="px-3 py-2 text-right font-mono">{fmt(gl.data.total_credit)}</td>
                <td></td>
              </tr>
            </tbody>
          </table>
        </div>
      )}

      {gl.data?.next_cursor && (
        <Button
          variant="secondary"
          onClick={handleLoadMore}
          disabled={gl.isFetching}
          data-testid="gl-load-more"
        >
          {gl.isFetching ? 'Loading…' : 'Load more'}
        </Button>
      )}
    </div>
  );
}
