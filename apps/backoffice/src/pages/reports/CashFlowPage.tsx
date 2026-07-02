// apps/backoffice/src/pages/reports/CashFlowPage.tsx
//
// Cash flow statement (indirect method). MVP: Operating section filled
// in, Investing/Financing zero placeholders (D-W6-6A-2).
//
// S31 : account cells terminal — get_cash_flow_v1 RPC returns `code`, not UUID.
// /accounting/general-ledger expects UUID. Pre-filled drill deferred to S32+ (RPC bump).

import { useMemo } from 'react';
import { toLocalDateStr, previousPeriod } from '@breakery/domain';
import type { CsvColumn } from '@breakery/domain';
import { ReportPage } from '@/features/reports/components/ReportPage.js';
import { DateRangePickerWithCompare } from '@/features/reports/components/DateRangePickerWithCompare.js';
import { DeltaPct } from '@/features/reports/components/DeltaPct.js';
import { useCashFlow } from '@/features/reports/hooks/useCashFlow.js';
import { useUrlState, useUrlBoolean } from '@/hooks/useUrlState.js';
import type { CashFlow } from '@/features/reports/hooks/useCashFlow.js';
import { ExportButtons } from '@/features/reports/components/ExportButtons.js';

interface CfRow { section: string; label: string; value: number }

function buildCfRows(d: CashFlow): CfRow[] {
  return [
    { section: 'Operating', label: 'Net profit',            value: d.operating.net_profit },
    { section: 'Operating', label: 'Δ accounts receivable', value: d.operating.delta_ar },
    { section: 'Operating', label: 'Δ accounts payable',    value: d.operating.delta_ap },
    { section: 'Operating', label: 'Δ inventory',           value: d.operating.delta_inventory },
    { section: 'Operating', label: 'Non-cash adjustments',  value: d.operating.non_cash_adjustments },
    { section: 'Operating', label: 'Total operating',       value: d.operating.total },
    { section: 'Investing', label: 'Total investing',       value: d.investing.total },
    { section: 'Financing', label: 'Total financing',       value: d.financing.total },
    { section: 'Summary',   label: 'Net change in cash',    value: d.net_change_in_cash },
    { section: 'Summary',   label: 'Cash, start of period', value: d.cash_start },
    { section: 'Summary',   label: 'Cash, end of period',   value: d.cash_end },
  ];
}

const cfCsvColumns: CsvColumn<CfRow>[] = [
  { header: 'Section', accessor: (r) => r.section, format: 'text' },
  { header: 'Label',   accessor: (r) => r.label,   format: 'text' },
  { header: 'Value',   accessor: (r) => r.value,   format: 'idr-round100' },
];

function defaultStart(): string {
  return toLocalDateStr(new Date(Date.now() - 29 * 86_400_000));
}
function fmt(n: number): string {
  return n.toLocaleString(undefined, { maximumFractionDigits: 2 });
}

export default function CashFlowPage() {
  const [start, setStart] = useUrlState('start', defaultStart());
  const [end,   setEnd]   = useUrlState('end', toLocalDateStr(new Date()));
  const [compare, setCompare] = useUrlBoolean('compare');

  const prev = useMemo(() => compare ? previousPeriod(start, end) : null, [compare, start, end]);

  const { data, isLoading, error } = useCashFlow(start, end);
  const { data: prevData } = useCashFlow(
    prev?.start ?? start,
    prev?.end   ?? end,
  );

  const showDelta = compare && !!prevData;

  return (
    <ReportPage
      title="Cash Flow Statement"
      subtitle="Indirect method (operating) + account-classified investing / financing totals via accounts.cash_flow_section."
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
              csv={{ rows: buildCfRows(data), columns: cfCsvColumns, filename: `cash-flow-${start}_${end}` }}
              pdf={{
                template: 'cf',
                data,
                period: { start, end },
                filename: `cash-flow-${start}_${end}`,
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
          <table className="w-full text-sm" aria-label="Cash flow summary">
            <tbody>
              <tr className="border-b border-border-subtle bg-bg-overlay">
                <td className="py-2 font-medium uppercase tracking-wider">Operating activities</td>
                <td className="py-2 text-right tabular-nums">{fmt(data.operating.total)}</td>
              </tr>
              <tr><td className="pl-6 py-1 text-text-secondary text-xs">Net profit</td><td className="py-1 text-right text-xs tabular-nums">{fmt(data.operating.net_profit)}</td></tr>
              <tr><td className="pl-6 py-1 text-text-secondary text-xs">Δ accounts receivable</td><td className="py-1 text-right text-xs tabular-nums">{fmt(data.operating.delta_ar)}</td></tr>
              <tr><td className="pl-6 py-1 text-text-secondary text-xs">Δ accounts payable</td><td className="py-1 text-right text-xs tabular-nums">{fmt(data.operating.delta_ap)}</td></tr>
              <tr><td className="pl-6 py-1 text-text-secondary text-xs">Δ inventory</td><td className="py-1 text-right text-xs tabular-nums">{fmt(data.operating.delta_inventory)}</td></tr>
              <tr><td className="pl-6 py-1 text-text-secondary text-xs">Non-cash adjustments</td><td className="py-1 text-right text-xs tabular-nums">{fmt(data.operating.non_cash_adjustments)}</td></tr>

              <tr className="border-b border-border-subtle bg-bg-overlay">
                <td className="py-2 font-medium uppercase tracking-wider">Investing activities</td>
                <td className="py-2 text-right tabular-nums">{fmt(data.investing.total)}</td>
              </tr>
              <tr><td className="pl-6 py-1 text-text-secondary text-xs">Fixed assets &amp; capex (accounts classified investing)</td><td className="py-1 text-right text-xs tabular-nums">{fmt(data.investing.total)}</td></tr>

              <tr className="border-b border-border-subtle bg-bg-overlay">
                <td className="py-2 font-medium uppercase tracking-wider">Financing activities</td>
                <td className="py-2 text-right tabular-nums">{fmt(data.financing.total)}</td>
              </tr>
              <tr><td className="pl-6 py-1 text-text-secondary text-xs">Loans &amp; equity (accounts classified financing)</td><td className="py-1 text-right text-xs tabular-nums">{fmt(data.financing.total)}</td></tr>

              <tr className="border-t-2 border-border-subtle bg-gold-soft">
                <td className="py-3 font-semibold uppercase tracking-wider">Net change in cash</td>
                <td className="py-3 text-right font-semibold tabular-nums">{fmt(data.net_change_in_cash)}</td>
              </tr>
              {showDelta && (
                <tr>
                  <td className="py-1 text-xs text-text-secondary pl-2">Net change vs prev. period</td>
                  <td className="py-1 text-right">
                    <DeltaPct current={data.net_change_in_cash} previous={prevData!.net_change_in_cash} />
                  </td>
                </tr>
              )}
              <tr className="border-b border-border-subtle">
                <td className="py-2 text-text-secondary">Cash, start of period</td>
                <td className="py-2 text-right tabular-nums">{fmt(data.cash_start)}</td>
              </tr>
              <tr>
                <td className="py-2 text-text-secondary">Cash, end of period</td>
                <td className="py-2 text-right tabular-nums">{fmt(data.cash_end)}</td>
              </tr>
              {showDelta && (
                <tr>
                  <td className="py-1 text-xs text-text-secondary pl-2">Ending cash vs prev. period</td>
                  <td className="py-1 text-right">
                    <DeltaPct current={data.cash_end} previous={prevData!.cash_end} />
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      )}
    </ReportPage>
  );
}
