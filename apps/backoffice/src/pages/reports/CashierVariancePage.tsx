// apps/backoffice/src/pages/reports/CashierVariancePage.tsx
//
// Cashier shift-variance report (fiche 12 D2.4). One row per cashier (3 volets)
// sorted by biggest cumulative cash shortfall, plus a cash day-of-week matrix.
// Read-only. CSV export of the summary table (no PDF in v1).

import { toLocalDateStr } from '@breakery/domain';
import type { CsvColumn } from '@breakery/domain';
import { ReportPage } from '@/features/reports/components/ReportPage.js';
import { DateRangePicker } from '@/features/reports/components/DateRangePicker.js';
import { ExportButtons } from '@/features/reports/components/ExportButtons.js';
import { useUrlState } from '@/hooks/useUrlState.js';
import { useCashierVariance } from '@/features/reports/hooks/useCashierVariance.js';
import type { CashierVarianceRow } from '@/features/reports/hooks/useCashierVariance.js';

const DOW_LABELS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

const csvColumns: CsvColumn<CashierVarianceRow>[] = [
  { header: 'Cashier',       accessor: (r) => r.cashier_name,          format: 'text' },
  { header: 'Sessions',      accessor: (r) => r.sessions_count,        format: 'number' },
  { header: 'Cash Variance', accessor: (r) => r.cash.total_variance,   format: 'idr-round100' },
  { header: 'Cash Avg',      accessor: (r) => r.cash.avg_variance,     format: 'idr-round100' },
  { header: 'Short #',       accessor: (r) => r.cash.short_count,      format: 'number' },
  { header: 'Over #',        accessor: (r) => r.cash.over_count,       format: 'number' },
  { header: 'Worst',         accessor: (r) => r.cash.worst_variance,   format: 'idr-round100' },
  { header: 'QRIS Variance', accessor: (r) => r.qris.total_variance,   format: 'idr-round100' },
  { header: 'Card Variance', accessor: (r) => r.card.total_variance,   format: 'idr-round100' },
];

function defaultStart(): string {
  return toLocalDateStr(new Date(Date.now() - 29 * 86_400_000));
}

function varianceClass(v: number): string {
  if (v < 0) return 'text-danger';
  if (v > 0) return 'text-success';
  return 'text-text-secondary';
}

function fmt(v: number): string {
  return Math.round(v).toLocaleString();
}

export default function CashierVariancePage() {
  const [start, setStart] = useUrlState('start', defaultStart());
  const [end,   setEnd]   = useUrlState('end', toLocalDateStr(new Date()));
  const { data, isLoading, error } = useCashierVariance(start, end);

  const rows = data?.cashiers ?? [];

  return (
    <ReportPage
      title="Cashier Variance"
      subtitle="Shift-close cash / QRIS / card variance per cashier, with a cash day-of-week breakdown."
      isEmpty={!isLoading && !error && rows.length === 0}
      emptyState={{
        title: 'No closed shifts',
        description: 'No shift was closed in the selected date range.',
      }}
      filters={
        <div className="flex items-center gap-3">
          <DateRangePicker start={start} end={end} onStartChange={setStart} onEndChange={setEnd} />
          {rows.length > 0 && (
            <ExportButtons
              csv={{ rows, columns: csvColumns, filename: `cashier-variance-${start}_${end}` }}
            />
          )}
        </div>
      }
    >
      {isLoading && <p className="text-sm text-text-secondary">Loading…</p>}
      {error && (
        <p className="text-sm text-danger" role="alert">
          {error.message === 'permission_denied'
            ? 'You do not have permission to view this report.'
            : (error.message ?? 'Failed to load report.')}
        </p>
      )}
      {!isLoading && !error && rows.length > 0 && (
        <div className="space-y-6">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-text-secondary border-b border-border-subtle">
                <th className="py-2 text-left">Cashier</th>
                <th className="py-2 text-right">Sessions</th>
                <th className="py-2 text-right">Cash Δ</th>
                <th className="py-2 text-right">Avg</th>
                <th className="py-2 text-right">Short</th>
                <th className="py-2 text-right">Over</th>
                <th className="py-2 text-right">Worst</th>
                <th className="py-2 text-right">QRIS Δ</th>
                <th className="py-2 text-right">Card Δ</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.cashier_id} className="border-b border-border-subtle">
                  <td className="py-2">{r.cashier_name}</td>
                  <td className="py-2 text-right tabular-nums">{r.sessions_count}</td>
                  <td className={`py-2 text-right tabular-nums ${varianceClass(r.cash.total_variance)}`}>{fmt(r.cash.total_variance)}</td>
                  <td className="py-2 text-right tabular-nums">{fmt(r.cash.avg_variance)}</td>
                  <td className="py-2 text-right tabular-nums">{r.cash.short_count}</td>
                  <td className="py-2 text-right tabular-nums">{r.cash.over_count}</td>
                  <td className={`py-2 text-right tabular-nums ${varianceClass(r.cash.worst_variance)}`}>{fmt(r.cash.worst_variance)}</td>
                  <td className="py-2 text-right tabular-nums">{r.qris.counted_sessions === 0 ? '—' : fmt(r.qris.total_variance)}</td>
                  <td className="py-2 text-right tabular-nums">{r.card.counted_sessions === 0 ? '—' : fmt(r.card.total_variance)}</td>
                </tr>
              ))}
            </tbody>
          </table>

          {/* Cash variance by day of week — the "recurring shortfall on Tuesdays" signal. */}
          <div>
            <h3 className="text-sm font-medium mb-2">Cash variance by day of week</h3>
            <table className="w-full text-sm">
              <thead>
                <tr className="text-text-secondary border-b border-border-subtle">
                  <th className="py-2 text-left">Cashier</th>
                  {DOW_LABELS.map((d) => (
                    <th key={d} className="py-2 text-right">{d}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => {
                  const byDow = new Map(r.dow_cash.map((c) => [c.dow, c.total_variance]));
                  return (
                    <tr key={r.cashier_id} className="border-b border-border-subtle">
                      <td className="py-2">{r.cashier_name}</td>
                      {DOW_LABELS.map((_, dow) => {
                        const v = byDow.get(dow);
                        return (
                          <td key={dow} className={`py-2 text-right tabular-nums ${v === undefined ? 'text-text-secondary' : varianceClass(v)}`}>
                            {v === undefined ? '·' : fmt(v)}
                          </td>
                        );
                      })}
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </ReportPage>
  );
}
