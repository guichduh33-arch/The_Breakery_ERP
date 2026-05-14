// apps/backoffice/src/pages/reports/BalanceSheetPage.tsx
//
// Snapshot of assets / liabilities / equity as of a chosen date.
// Includes the balanced indicator (green when |A - (L+E+CYE)| < 0.01).

import { useState } from 'react';
import { Input } from '@breakery/ui';
import { toLocalDateStr } from '@breakery/domain';
import { ReportPage } from '@/features/reports/components/ReportPage.js';
import { useBalanceSheet } from '@/features/reports/hooks/useBalanceSheet.js';

function fmt(n: number): string {
  return n.toLocaleString(undefined, { maximumFractionDigits: 2 });
}

export default function BalanceSheetPage() {
  const [asOf, setAsOf] = useState<string>(() => toLocalDateStr(new Date()));
  const { data, isLoading, error } = useBalanceSheet(asOf);

  return (
    <ReportPage
      title="Balance Sheet"
      subtitle="Assets, liabilities and equity as of a chosen date. CYE computed live."
      filters={
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
                  <tr className="border-t-2 border-border-subtle bg-gold-soft"><td className="py-3 font-semibold uppercase tracking-wider">Total assets</td><td className="py-3 text-right font-semibold tabular-nums">{fmt(data.assets.total)}</td></tr>
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
                  <tr className="border-t-2 border-border-subtle bg-gold-soft"><td className="py-3 font-semibold uppercase tracking-wider">Total liabilities</td><td className="py-3 text-right font-semibold tabular-nums">{fmt(data.liabilities.total)}</td></tr>
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
                  <tr className="border-t-2 border-border-subtle bg-gold-soft"><td className="py-3 font-semibold uppercase tracking-wider">Total equity</td><td className="py-3 text-right font-semibold tabular-nums">{fmt(data.equity.total)}</td></tr>
                </tbody>
              </table>
            </section>
          </div>
        </div>
      )}
    </ReportPage>
  );
}
