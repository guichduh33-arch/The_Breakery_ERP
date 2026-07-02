// apps/backoffice/src/pages/reports/BalanceSheetPage.tsx
//
// Snapshot of assets / liabilities / equity as of a chosen date.
// Includes the balanced indicator (green when |A - (L+E+CYE)| < 0.01).
//
// S32 / Wave 3.E : account codes in the per-account detail table now drill into
// /accounting/general-ledger via DrilldownLink, using account_id UUID surfaced
// by the bumped RPC (S32 Wave 1.C). The aggregated 3-column A=L+E view above
// stays category-rolled (cash/ar/inventory…) since those are 1:N to accounts.

import { useMemo } from 'react';
import { Input } from '@breakery/ui';
import { toLocalDateStr, previousPeriod } from '@breakery/domain';
import type { CsvColumn } from '@breakery/domain';
import { ReportPage } from '@/features/reports/components/ReportPage.js';
import { DeltaPct } from '@/features/reports/components/DeltaPct.js';
import { DrilldownLink } from '@/features/reports/components/DrilldownLink.js';
import { useBalanceSheet } from '@/features/reports/hooks/useBalanceSheet.js';
import { useUrlState, useUrlBoolean } from '@/hooks/useUrlState.js';
import type { BalanceSheet } from '@/features/reports/hooks/useBalanceSheet.js';
import { ExportButtons } from '@/features/reports/components/ExportButtons.js';

interface BsRow { section: string; account: string; value: number }

function buildBsRows(d: BalanceSheet): BsRow[] {
  return [
    { section: 'Assets',      account: 'Cash',                  value: d.assets.current.cash },
    { section: 'Assets',      account: 'Accounts receivable',   value: d.assets.current.ar },
    { section: 'Assets',      account: 'Inventory',             value: d.assets.current.inventory },
    { section: 'Assets',      account: 'Other current',         value: d.assets.current.other },
    { section: 'Assets',      account: 'Fixed assets',          value: d.assets.fixed.total },
    { section: 'Assets',      account: 'Total assets',          value: d.assets.total },
    { section: 'Liabilities', account: 'Accounts payable',      value: d.liabilities.current.ap },
    { section: 'Liabilities', account: 'Tax payable',           value: d.liabilities.current.tax_payable },
    { section: 'Liabilities', account: 'Loyalty liability',     value: d.liabilities.current.loyalty },
    { section: 'Liabilities', account: 'Other current',         value: d.liabilities.current.other },
    { section: 'Liabilities', account: 'Long-term liabilities', value: d.liabilities.long_term.total },
    { section: 'Liabilities', account: 'Total liabilities',     value: d.liabilities.total },
    { section: 'Equity',      account: 'Share capital',         value: d.equity.share_capital },
    { section: 'Equity',      account: 'Retained earnings',     value: d.equity.retained_earnings },
    { section: 'Equity',      account: 'Current year earnings', value: d.equity.current_year_earnings },
    { section: 'Equity',      account: 'Other',                 value: d.equity.other },
    { section: 'Equity',      account: 'Total equity',          value: d.equity.total },
  ];
}

const bsCsvColumns: CsvColumn<BsRow>[] = [
  { header: 'Section', accessor: (r) => r.section, format: 'text' },
  { header: 'Account', accessor: (r) => r.account, format: 'text' },
  { header: 'Value',   accessor: (r) => r.value,   format: 'idr-round100' },
];

function fmt(n: number): string {
  return n.toLocaleString(undefined, { maximumFractionDigits: 2 });
}

export default function BalanceSheetPage() {
  const [asOf, setAsOf] = useUrlState('asOf', toLocalDateStr(new Date()));
  const [compare, setCompare] = useUrlBoolean('compare');

  // For a balance sheet snapshot, the previous period is the end of the prior equivalent window.
  const prevAsOf = useMemo(() => compare ? previousPeriod(asOf, asOf).end : null, [compare, asOf]);

  const { data, isLoading, error } = useBalanceSheet(asOf);
  const { data: prevData } = useBalanceSheet(prevAsOf ?? asOf);

  const showDelta = compare && !!prevData;

  return (
    <ReportPage
      title="Balance Sheet"
      subtitle="Assets, liabilities and equity as of a chosen date. CYE computed live."
      filters={
        <div className="flex items-center gap-3">
          <label className="flex items-center gap-1 text-sm text-text-secondary">
            <span>As of</span>
            <Input
              type="date"
              value={asOf}
              onChange={(e) => setAsOf(e.target.value)}
              className="h-9 w-40"
              aria-label="Balance sheet as-of date"
            />
          </label>
          <label className="flex items-center gap-1 text-xs text-text-secondary cursor-pointer">
            <input
              id="bs-cmp-prev"
              type="checkbox"
              checked={compare}
              onChange={(e) => setCompare(e.target.checked)}
              data-testid="compare-toggle"
              className="h-3.5 w-3.5"
            />
            <span>Compare to previous period</span>
          </label>
          {data && (
            <ExportButtons
              csv={{ rows: buildBsRows(data), columns: bsCsvColumns, filename: `balance-sheet-${asOf}` }}
              pdf={{
                template: 'bs',
                data,
                filename: `balance-sheet-${asOf}`,
                ...(showDelta && prevData ? { comparePrevious: { data: prevData } } : {}),
              }}
            />
          )}
        </div>
      }
    >
      {isLoading && <p className="text-sm text-text-secondary">Loading…</p>}
      {error && (
        <p className="text-sm text-red-500" role="alert">
          {error.message ?? 'Failed to load report.'}
        </p>
      )}
      {data && (
        <div className="space-y-6">
          {/* Balanced indicator */}
          <div
            className={
              data.balanced
                ? 'rounded-md bg-green-50 border border-green-200 text-green-800 px-4 py-2 text-sm'
                : 'rounded-md bg-red-50 border border-red-200 text-red-800 px-4 py-2 text-sm'
            }
            role={data.balanced ? 'status' : 'alert'}
            aria-label="Balanced indicator"
          >
            {data.balanced
              ? `Balanced: Assets = Liabilities + Equity (delta ${fmt(data.delta)})`
              : `Not balanced (delta ${fmt(data.delta)})`}
          </div>

          {/* 3-column A = L + E */}
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            {/* Assets */}
            <section aria-label="Assets">
              <h2 className="text-sm font-medium uppercase tracking-widest text-text-secondary mb-2">Assets</h2>
              <table className="w-full text-sm">
                <tbody>
                  <tr className="border-b border-border-subtle"><td className="py-2 font-medium">Current assets</td><td className="py-2 text-right tabular-nums">{fmt(data.assets.current.total)}</td></tr>
                  <tr><td className="pl-4 py-1 text-text-secondary text-xs">Cash</td><td className="py-1 text-right text-xs tabular-nums">{fmt(data.assets.current.cash)}</td></tr>
                  <tr><td className="pl-4 py-1 text-text-secondary text-xs">Accounts receivable</td><td className="py-1 text-right text-xs tabular-nums">{fmt(data.assets.current.ar)}</td></tr>
                  <tr><td className="pl-4 py-1 text-text-secondary text-xs">Inventory</td><td className="py-1 text-right text-xs tabular-nums">{fmt(data.assets.current.inventory)}</td></tr>
                  <tr><td className="pl-4 py-1 text-text-secondary text-xs">Other current</td><td className="py-1 text-right text-xs tabular-nums">{fmt(data.assets.current.other)}</td></tr>
                  <tr className="border-b border-border-subtle"><td className="py-2 font-medium">Fixed assets</td><td className="py-2 text-right tabular-nums">{fmt(data.assets.fixed.total)}</td></tr>
                  <tr className="border-t-2 border-border-subtle bg-gold-soft">
                    <td className="py-3 font-semibold uppercase tracking-wider">Total assets</td>
                    <td className="py-3 text-right font-semibold tabular-nums">{fmt(data.assets.total)}</td>
                  </tr>
                  {showDelta && (
                    <tr>
                      <td className="py-1 text-xs text-text-secondary">vs prev. period</td>
                      <td className="py-1 text-right"><DeltaPct current={data.assets.total} previous={prevData!.assets.total} /></td>
                    </tr>
                  )}
                </tbody>
              </table>
            </section>

            {/* Liabilities */}
            <section aria-label="Liabilities">
              <h2 className="text-sm font-medium uppercase tracking-widest text-text-secondary mb-2">Liabilities</h2>
              <table className="w-full text-sm">
                <tbody>
                  <tr className="border-b border-border-subtle"><td className="py-2 font-medium">Current liabilities</td><td className="py-2 text-right tabular-nums">{fmt(data.liabilities.current.total)}</td></tr>
                  <tr><td className="pl-4 py-1 text-text-secondary text-xs">Accounts payable</td><td className="py-1 text-right text-xs tabular-nums">{fmt(data.liabilities.current.ap)}</td></tr>
                  <tr><td className="pl-4 py-1 text-text-secondary text-xs">Tax payable</td><td className="py-1 text-right text-xs tabular-nums">{fmt(data.liabilities.current.tax_payable)}</td></tr>
                  <tr><td className="pl-4 py-1 text-text-secondary text-xs">Loyalty liability</td><td className="py-1 text-right text-xs tabular-nums">{fmt(data.liabilities.current.loyalty)}</td></tr>
                  <tr><td className="pl-4 py-1 text-text-secondary text-xs">Other current</td><td className="py-1 text-right text-xs tabular-nums">{fmt(data.liabilities.current.other)}</td></tr>
                  <tr className="border-b border-border-subtle"><td className="py-2 font-medium">Long-term liabilities</td><td className="py-2 text-right tabular-nums">{fmt(data.liabilities.long_term.total)}</td></tr>
                  <tr className="border-t-2 border-border-subtle bg-gold-soft">
                    <td className="py-3 font-semibold uppercase tracking-wider">Total liabilities</td>
                    <td className="py-3 text-right font-semibold tabular-nums">{fmt(data.liabilities.total)}</td>
                  </tr>
                  {showDelta && (
                    <tr>
                      <td className="py-1 text-xs text-text-secondary">vs prev. period</td>
                      <td className="py-1 text-right"><DeltaPct current={data.liabilities.total} previous={prevData!.liabilities.total} /></td>
                    </tr>
                  )}
                </tbody>
              </table>
            </section>

            {/* Equity */}
            <section aria-label="Equity">
              <h2 className="text-sm font-medium uppercase tracking-widest text-text-secondary mb-2">Equity</h2>
              <table className="w-full text-sm">
                <tbody>
                  <tr className="border-b border-border-subtle"><td className="py-2">Share capital</td><td className="py-2 text-right tabular-nums">{fmt(data.equity.share_capital)}</td></tr>
                  <tr className="border-b border-border-subtle"><td className="py-2">Retained earnings</td><td className="py-2 text-right tabular-nums">{fmt(data.equity.retained_earnings)}</td></tr>
                  <tr className="border-b border-border-subtle"><td className="py-2">Current year earnings</td><td className="py-2 text-right tabular-nums">{fmt(data.equity.current_year_earnings)}</td></tr>
                  <tr className="border-b border-border-subtle"><td className="py-2">Other</td><td className="py-2 text-right tabular-nums">{fmt(data.equity.other)}</td></tr>
                  <tr className="border-t-2 border-border-subtle bg-gold-soft">
                    <td className="py-3 font-semibold uppercase tracking-wider">Total equity</td>
                    <td className="py-3 text-right font-semibold tabular-nums">{fmt(data.equity.total)}</td>
                  </tr>
                  {showDelta && (
                    <tr>
                      <td className="py-1 text-xs text-text-secondary">vs prev. period</td>
                      <td className="py-1 text-right"><DeltaPct current={data.equity.total} previous={prevData!.equity.total} /></td>
                    </tr>
                  )}
                </tbody>
              </table>
            </section>
          </div>

          {/* Per-account drill-down (S32 Wave 3.E) — click any code to open the GL */}
          {data.lines.length > 0 && (
            <section aria-label="Per-account detail">
              <h2 className="text-sm font-medium uppercase tracking-widest text-text-secondary mb-2">
                Per-account detail
              </h2>
              <table className="w-full text-sm" data-testid="bs-account-detail">
                <thead className="text-left text-xs text-text-secondary">
                  <tr className="border-b border-border-subtle">
                    <th className="py-2">Code</th>
                    <th className="py-2">Name</th>
                    <th className="py-2 text-right">Debit</th>
                    <th className="py-2 text-right">Credit</th>
                    <th className="py-2 text-right">Balance</th>
                  </tr>
                </thead>
                <tbody>
                  {data.lines.map((l) => (
                    <tr key={l.account_id || l.code} className="border-b border-border-subtle">
                      <td className="py-2">
                        <DrilldownLink
                          entity="account"
                          id={l.account_id}
                          label={l.code}
                          filter={{ start: asOf, end: asOf }}
                          icon={false}
                        />
                      </td>
                      <td className="py-2">{l.name}</td>
                      <td className="py-2 text-right tabular-nums">{fmt(l.debit)}</td>
                      <td className="py-2 text-right tabular-nums">{fmt(l.credit)}</td>
                      <td className="py-2 text-right tabular-nums">{fmt(l.balance)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </section>
          )}
        </div>
      )}
    </ReportPage>
  );
}
