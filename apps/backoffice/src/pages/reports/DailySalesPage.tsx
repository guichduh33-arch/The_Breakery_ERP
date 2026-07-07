// apps/backoffice/src/pages/reports/DailySalesPage.tsx
// S40 Wave B1 — Per-day gross/refunds/net/AOV with summary KPI cards + drill-down.

import { Link } from 'react-router-dom';
import { toLocalDateStr } from '@breakery/domain';
import type { CsvColumn } from '@breakery/domain';
import { KpiTile } from '@breakery/ui';
import { ReportPage } from '@/features/reports/components/ReportPage.js';
import { DateRangePicker } from '@/features/reports/components/DateRangePicker.js';
import { ExportButtons } from '@/features/reports/components/ExportButtons.js';
import { buildDrilldownUrl } from '@/features/reports/utils/buildDrilldownUrl.js';
import {
  useDailySales,
  type DailySalesRow,
} from '@/features/reports/hooks/useDailySales.js';
import { useUrlState } from '@/hooks/useUrlState.js';

const csvColumns: CsvColumn<DailySalesRow>[] = [
  { header: 'Date',        accessor: (r) => r.date,        format: 'text' },
  { header: 'Orders',      accessor: (r) => r.order_count, format: 'number' },
  { header: 'Gross (IDR)', accessor: (r) => r.gross,       format: 'idr-round100' },
  { header: 'Refunds (IDR)', accessor: (r) => r.refunds,   format: 'idr-round100' },
  { header: 'Net (IDR)',   accessor: (r) => r.net,         format: 'idr-round100' },
  { header: 'AOV (IDR)',   accessor: (r) => r.aov,         format: 'idr-round100' },
];

const IDR = (v: number) =>
  v.toLocaleString('id-ID', { style: 'currency', currency: 'IDR', maximumFractionDigits: 0 });

function defaultStart(): string {
  return toLocalDateStr(new Date(Date.now() - 29 * 86_400_000));
}

export default function DailySalesPage() {
  const [start, setStart] = useUrlState('start', defaultStart());
  const [end,   setEnd]   = useUrlState('end', toLocalDateStr(new Date()));

  const { data, isLoading, error } = useDailySales({ start, end });

  const byDay    = data?.by_day  ?? [];
  const summary  = data?.summary;

  return (
    <ReportPage
      title="Daily Sales"
      subtitle="Per-day gross, refunds, net and average order value."
      isEmpty={!isLoading && !error && data !== undefined && byDay.length === 0}
      emptyState={{
        title: 'No sales',
        description: 'No sales for this period.',
      }}
      filters={
        <div className="flex items-center gap-3">
          <DateRangePicker
            start={start}
            end={end}
            onStartChange={setStart}
            onEndChange={setEnd}
          />
          {data && (
            <ExportButtons
              csv={{ rows: byDay, columns: csvColumns, filename: `daily-sales-${start}_${end}` }}
            />
          )}
        </div>
      }
    >
      {isLoading && <p className="text-sm text-text-secondary">Loading…</p>}
      {error && (
        <p className="text-sm text-danger" role="alert">
          {error.message ?? 'Failed to load report.'}
        </p>
      )}

      {summary && (
        <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-5 mb-6">
          <KpiTile
            label="Total (Gross)"
            value={summary.total}
            valueFormat="currency"
          />
          <KpiTile
            label="Orders"
            value={summary.order_count}
            valueFormat="number"
          />
          <KpiTile
            label="AOV"
            value={summary.aov}
            valueFormat="currency"
          />
          <KpiTile
            label="Refunds"
            value={summary.refund_total}
            valueFormat="currency"
          />
          <KpiTile
            label="Net"
            value={summary.net}
            valueFormat="currency"
          />
        </div>
      )}

      {data && (
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-border-subtle text-text-secondary">
              <th className="py-2 text-left">Date</th>
              <th className="py-2 text-right">Orders</th>
              <th className="py-2 text-right">Gross</th>
              <th className="py-2 text-right">Refunds</th>
              <th className="py-2 text-right">Net</th>
              <th className="py-2 text-right">AOV</th>
            </tr>
          </thead>
          <tbody>
            {byDay.map((r) => {
              const drillUrl = buildDrilldownUrl('order_list', '', { start: r.date, end: r.date });
              return (
                <tr key={r.date} className="border-b border-border-subtle">
                  <td className="py-2 font-medium tabular-nums">
                    {drillUrl ? (
                      <Link
                        to={drillUrl}
                        className="text-brand hover:underline"
                      >
                        {r.date}
                      </Link>
                    ) : (
                      r.date
                    )}
                  </td>
                  <td className="py-2 text-right tabular-nums">{r.order_count}</td>
                  <td className="py-2 text-right tabular-nums">{IDR(r.gross)}</td>
                  <td className="py-2 text-right tabular-nums">{IDR(r.refunds)}</td>
                  <td className="py-2 text-right tabular-nums">{IDR(r.net)}</td>
                  <td className="py-2 text-right tabular-nums">{IDR(r.aov)}</td>
                </tr>
              );
            })}
          </tbody>
          {byDay.length > 0 && summary && (
            <tfoot>
              <tr className="border-t border-border-subtle font-semibold">
                <td className="py-2">Total</td>
                <td className="py-2 text-right tabular-nums">{summary.order_count}</td>
                <td className="py-2 text-right tabular-nums">{IDR(summary.total)}</td>
                <td className="py-2 text-right tabular-nums">{IDR(summary.refund_total)}</td>
                <td className="py-2 text-right tabular-nums">{IDR(summary.net)}</td>
                <td className="py-2 text-right tabular-nums">{IDR(summary.aov)}</td>
              </tr>
            </tfoot>
          )}
        </table>
      )}
    </ReportPage>
  );
}
