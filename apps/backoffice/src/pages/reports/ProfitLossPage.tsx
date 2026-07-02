// apps/backoffice/src/pages/reports/ProfitLossPage.tsx
//
// Profit & Loss statement for a date range. Renders subtotals
// (revenue / COGS / gross / OpEx / net) and a per-account drill-down
// table sorted by code.
//
// S32 / Wave 3.D : account cells now drill into /accounting/general-ledger via
// DrilldownLink, using account_id UUID surfaced by the bumped RPC (S32 Wave 1.B).

import { useMemo } from 'react';
import { toLocalDateStr, previousPeriod } from '@breakery/domain';
import type { CsvColumn } from '@breakery/domain';
import { ReportPage } from '@/features/reports/components/ReportPage.js';
import { DateRangePickerWithCompare } from '@/features/reports/components/DateRangePickerWithCompare.js';
import { DeltaPct } from '@/features/reports/components/DeltaPct.js';
import { DrilldownLink } from '@/features/reports/components/DrilldownLink.js';
import { useProfitLoss } from '@/features/reports/hooks/useProfitLoss.js';
import { useUrlState, useUrlBoolean } from '@/hooks/useUrlState.js';
import { ExportButtons } from '@/features/reports/components/ExportButtons.js';
import type { PnlLine } from '@/features/reports/hooks/useProfitLoss.js';

const pnlLineColumns: CsvColumn<PnlLine>[] = [
  { header: 'Code',    accessor: (r) => r.code,    format: 'text' },
  { header: 'Name',    accessor: (r) => r.name,    format: 'text' },
  { header: 'Debit',   accessor: (r) => r.debit,   format: 'idr-round100' },
  { header: 'Credit',  accessor: (r) => r.credit,  format: 'idr-round100' },
  { header: 'Balance', accessor: (r) => r.balance, format: 'idr-round100' },
];

function defaultStart(): string {
  return toLocalDateStr(new Date(Date.now() - 29 * 86_400_000));
}

function fmt(n: number): string {
  return n.toLocaleString(undefined, { maximumFractionDigits: 2 });
}

export default function ProfitLossPage() {
  const [start, setStart] = useUrlState('start', defaultStart());
  const [end,   setEnd]   = useUrlState('end', toLocalDateStr(new Date()));
  const [compare, setCompare] = useUrlBoolean('compare');

  const prev = useMemo(() => compare ? previousPeriod(start, end) : null, [compare, start, end]);

  const { data, isLoading, error } = useProfitLoss(start, end);
  const { data: prevData } = useProfitLoss(
    prev?.start ?? start,
    prev?.end   ?? end,
  );

  const showDelta = compare && !!prevData;

  return (
    <ReportPage
      title="Profit & Loss"
      subtitle="Revenue, COGS and operating expenses across a date range."
      filters={
        <div className="flex items-center gap-3">
          <DateRangePickerWithCompare
            start={start}
            end={end}
            onStartChange={setStart}
            onEndChange={setEnd}
            compare={compare}
            onCompareChange={setCompare}
          />
          {data && (
            <ExportButtons
              csv={{ rows: data.lines, columns: pnlLineColumns, filename: `pnl-${start}_${end}` }}
              pdf={{
                template: 'pnl',
                data,
                period: { start, end },
                filename: `pnl-${start}_${end}`,
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
          <table className="w-full text-sm" aria-label="P&L summary">
            <tbody>
              <tr className="border-b border-border-subtle">
                <td className="py-2 font-medium">Revenue</td>
                <td className="py-2 text-right tabular-nums">{fmt(data.revenue.total)}</td>
                {showDelta && <td className="py-2 text-right pl-2"><DeltaPct current={data.revenue.total} previous={prevData!.revenue.total} /></td>}
              </tr>
              <tr>
                <td className="pl-6 py-1 text-text-secondary text-xs">Sales</td>
                <td className="py-1 text-right text-xs tabular-nums">{fmt(data.revenue.sales)}</td>
                {showDelta && <td />}
              </tr>
              <tr>
                <td className="pl-6 py-1 text-text-secondary text-xs">Discounts</td>
                <td className="py-1 text-right text-xs tabular-nums">{fmt(data.revenue.discounts)}</td>
                {showDelta && <td />}
              </tr>
              <tr>
                <td className="pl-6 py-1 text-text-secondary text-xs">Adjustments</td>
                <td className="py-1 text-right text-xs tabular-nums">{fmt(data.revenue.adjustments)}</td>
                {showDelta && <td />}
              </tr>
              <tr className="border-b border-border-subtle">
                <td className="py-2 font-medium">COGS</td>
                <td className="py-2 text-right tabular-nums">{fmt(data.cogs.total)}</td>
                {showDelta && <td className="py-2 text-right pl-2"><DeltaPct current={data.cogs.total} previous={prevData!.cogs.total} /></td>}
              </tr>
              <tr>
                <td className="pl-6 py-1 text-text-secondary text-xs">Production</td>
                <td className="py-1 text-right text-xs tabular-nums">{fmt(data.cogs.production)}</td>
                {showDelta && <td />}
              </tr>
              <tr>
                <td className="pl-6 py-1 text-text-secondary text-xs">Waste</td>
                <td className="py-1 text-right text-xs tabular-nums">{fmt(data.cogs.waste)}</td>
                {showDelta && <td />}
              </tr>
              <tr>
                <td className="pl-6 py-1 text-text-secondary text-xs">Other</td>
                <td className="py-1 text-right text-xs tabular-nums">{fmt(data.cogs.other)}</td>
                {showDelta && <td />}
              </tr>
              <tr className="border-b border-border-subtle bg-bg-overlay">
                <td className="py-2 font-semibold">Gross profit</td>
                <td className="py-2 text-right font-semibold tabular-nums">{fmt(data.gross_profit)}</td>
                {showDelta && <td className="py-2 text-right pl-2"><DeltaPct current={data.gross_profit} previous={prevData!.gross_profit} /></td>}
              </tr>
              <tr className="border-b border-border-subtle">
                <td className="py-2 font-medium">Operating expenses</td>
                <td className="py-2 text-right tabular-nums">{fmt(data.opex.total)}</td>
                {showDelta && <td />}
              </tr>
              <tr><td className="pl-6 py-1 text-text-secondary text-xs">Salary &amp; wages</td><td className="py-1 text-right text-xs tabular-nums">{fmt(data.opex.salary)}</td>{showDelta && <td />}</tr>
              <tr><td className="pl-6 py-1 text-text-secondary text-xs">Rent</td><td className="py-1 text-right text-xs tabular-nums">{fmt(data.opex.rent)}</td>{showDelta && <td />}</tr>
              <tr><td className="pl-6 py-1 text-text-secondary text-xs">Utilities</td><td className="py-1 text-right text-xs tabular-nums">{fmt(data.opex.utilities)}</td>{showDelta && <td />}</tr>
              <tr><td className="pl-6 py-1 text-text-secondary text-xs">Supplies</td><td className="py-1 text-right text-xs tabular-nums">{fmt(data.opex.supplies)}</td>{showDelta && <td />}</tr>
              <tr><td className="pl-6 py-1 text-text-secondary text-xs">Marketing</td><td className="py-1 text-right text-xs tabular-nums">{fmt(data.opex.marketing)}</td>{showDelta && <td />}</tr>
              <tr><td className="pl-6 py-1 text-text-secondary text-xs">Maintenance</td><td className="py-1 text-right text-xs tabular-nums">{fmt(data.opex.maintenance)}</td>{showDelta && <td />}</tr>
              <tr><td className="pl-6 py-1 text-text-secondary text-xs">Other</td><td className="py-1 text-right text-xs tabular-nums">{fmt(data.opex.other)}</td>{showDelta && <td />}</tr>
              <tr className="border-t-2 border-border-subtle bg-gold-soft">
                <td className="py-3 font-semibold uppercase tracking-wider">Net profit</td>
                <td className="py-3 text-right font-semibold tabular-nums">{fmt(data.net_profit)}</td>
                {showDelta && <td className="py-3 text-right pl-2"><DeltaPct current={data.net_profit} previous={prevData!.net_profit} /></td>}
              </tr>
            </tbody>
          </table>

          <section aria-label="Per-account drill-down">
            <h2 className="text-sm font-medium uppercase tracking-widest text-text-secondary mb-2">
              Lines (per account)
            </h2>
            <table className="w-full text-sm">
              <thead>
                <tr className="text-text-secondary border-b border-border-subtle">
                  <th className="py-2 text-left">Code</th>
                  <th className="py-2 text-left">Name</th>
                  <th className="py-2 text-right">Debit</th>
                  <th className="py-2 text-right">Credit</th>
                  <th className="py-2 text-right">Balance</th>
                </tr>
              </thead>
              <tbody>
                {data.lines.length === 0 ? (
                  <tr>
                    <td className="py-3 text-text-secondary" colSpan={5}>
                      No journal-entry activity in the selected range.
                    </td>
                  </tr>
                ) : (
                  data.lines.map((l) => (
                    <tr key={l.code} className="border-b border-border-subtle">
                      <td className="py-2">
                        <DrilldownLink
                          entity="account"
                          id={l.account_id}
                          label={l.code}
                          filter={{ start, end }}
                          icon={false}
                        />
                      </td>
                      <td className="py-2">{l.name}</td>
                      <td className="py-2 text-right tabular-nums">{fmt(l.debit)}</td>
                      <td className="py-2 text-right tabular-nums">{fmt(l.credit)}</td>
                      <td className="py-2 text-right tabular-nums">{fmt(l.balance)}</td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </section>
        </div>
      )}
    </ReportPage>
  );
}
