// apps/backoffice/src/pages/reports/SalesByHourPage.tsx
//
// 24-bucket bar chart of revenue by hour, for a given business-local date.
//
// S32 / Wave 3.J : per-hour drill-down — added a compact table below the chart
// where each hour wraps in <DrilldownLink entity="order_list"> filtering
// /backoffice/orders by hour=N + start=date + end=date. (hour filter is
// applied client-side post-fetch in OrdersListPage V1.)

import { useMemo } from 'react';
import {
  BarChart,
  Bar,
  CartesianGrid,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import { Input } from '@breakery/ui';
import { toLocalDateStr, previousPeriod } from '@breakery/domain';
import type { CsvColumn } from '@breakery/domain';
import { ReportPage } from '@/features/reports/components/ReportPage.js';
import { DeltaPct } from '@/features/reports/components/DeltaPct.js';
import { useSalesByHour } from '@/features/reports/hooks/useSalesByHour.js';
import { ExportButtons } from '@/features/reports/components/ExportButtons.js';
import { DrilldownLink } from '@/features/reports/components/DrilldownLink.js';
import { useUrlState, useUrlBoolean } from '@/hooks/useUrlState.js';
import { CHART_GRID_STROKE } from '@/features/reports/utils/chartColors.js';

import type { SalesHourRow } from '@/features/reports/hooks/useSalesByHour.js';

const csvColumns: CsvColumn<SalesHourRow>[] = [
  { header: 'Hour',        accessor: (r) => r.hour,        format: 'number' },
  { header: 'Revenue',     accessor: (r) => r.total,       format: 'idr-round100' },
  { header: 'Order Count', accessor: (r) => r.order_count, format: 'number' },
];

function sumRows(rows: SalesHourRow[]): { total: number; orders: number } {
  return rows.reduce(
    (acc, r) => ({ total: acc.total + r.total, orders: acc.orders + r.order_count }),
    { total: 0, orders: 0 },
  );
}

export default function SalesByHourPage() {
  const [date, setDate] = useUrlState('date', toLocalDateStr(new Date()));
  const [compare, setCompare] = useUrlBoolean('compare');

  // Previous period for a single day = the day before.
  const prevDate = useMemo(() => compare ? previousPeriod(date, date).end : null, [compare, date]);

  const { data, isLoading, error } = useSalesByHour(date);
  const { data: prevData } = useSalesByHour(prevDate ?? date);

  const showDelta = compare && !!prevData;

  const currentSums = useMemo(() => data ? sumRows(data) : null, [data]);
  const prevSums    = useMemo(() => prevData ? sumRows(prevData) : null, [prevData]);

  return (
    <ReportPage
      title="Sales by Hour"
      subtitle="Revenue distribution across 24 hours of a single business day."
      isEmpty={
        !isLoading && !error && data !== undefined && data.length > 0 &&
        data.every((r) => r.order_count === 0)
      }
      emptyState={{
        title: 'No orders',
        description: 'No orders recorded for this day.',
      }}
      filters={
        <div className="flex items-center gap-3">
          <label className="flex items-center gap-1 text-sm text-text-secondary">
            <span>Date</span>
            <Input
              type="date"
              value={date}
              onChange={(e) => setDate(e.target.value)}
              className="h-9 w-40"
              aria-label="Report date"
            />
          </label>
          <label className="flex items-center gap-1 text-xs text-text-secondary cursor-pointer">
            <input
              id="sbh-cmp-prev"
              type="checkbox"
              checked={compare}
              onChange={(e) => setCompare(e.target.checked)}
              data-testid="compare-toggle"
              className="h-3.5 w-3.5"
            />
            <span>Compare to previous day</span>
          </label>
          {data && (
            <ExportButtons
              csv={{ rows: data, columns: csvColumns, filename: `sales-by-hour-${date}` }}
              pdf={{
                template: 'sales_by_hour',
                data,
                period: { start: date, end: date },
                filename: `sales-by-hour-${date}`,
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
      {showDelta && currentSums && prevSums && (
        <div className="flex items-center gap-6 text-sm mb-4 p-3 rounded-md bg-bg-overlay border border-border-subtle">
          <span className="font-medium text-text-secondary">vs prev. day:</span>
          <span>
            Revenue&nbsp;
            <DeltaPct current={currentSums.total} previous={prevSums.total} />
          </span>
          <span>
            Orders&nbsp;
            <DeltaPct current={currentSums.orders} previous={prevSums.orders} />
          </span>
        </div>
      )}
      {data !== undefined && data !== null && (
        <>
          <div className="h-96 w-full">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={data} margin={{ top: 10, right: 20, bottom: 30, left: 0 }}>
                <CartesianGrid strokeDasharray="3 3" stroke={CHART_GRID_STROKE} />
                <XAxis
                  dataKey="hour"
                  label={{ value: 'Hour (local)', position: 'insideBottom', offset: -10 }}
                />
                <YAxis />
                <Tooltip
                  formatter={(value: unknown, name: string) =>
                    name === 'total'
                      ? [Number(value).toLocaleString(), 'Total']
                      : [Number(value), 'Orders']
                  }
                  labelFormatter={(label) => `Hour ${label as number}`}
                />
                <Bar dataKey="total" fill="var(--gold-base)" name="total" />
              </BarChart>
            </ResponsiveContainer>
          </div>

          {/* Per-hour drill-down (S32 Wave 3.J) — click an hour to open the orders list */}
          <section aria-label="Per-hour detail" className="mt-6">
            <h2 className="text-sm font-medium uppercase tracking-widest text-text-secondary mb-2">
              Per-hour detail
            </h2>
            <table className="w-full text-sm" data-testid="sbh-hour-detail">
              <thead className="text-left text-xs text-text-secondary">
                <tr className="border-b border-border-subtle">
                  <th className="py-2">Hour</th>
                  <th className="py-2 text-right">Revenue</th>
                  <th className="py-2 text-right">Orders</th>
                </tr>
              </thead>
              <tbody>
                {data.filter((r) => r.order_count > 0).map((r) => (
                  <tr key={r.hour} className="border-b border-border-subtle">
                    <td className="py-2 font-medium tabular-nums">
                      <DrilldownLink
                        entity="order_list"
                        id=""
                        label={`${String(r.hour).padStart(2, '0')}:00`}
                        filter={{ hour: r.hour, start: date, end: date }}
                        icon={false}
                      />
                    </td>
                    <td className="py-2 text-right tabular-nums">
                      {r.total.toLocaleString('id-ID', { style: 'currency', currency: 'IDR', maximumFractionDigits: 0 })}
                    </td>
                    <td className="py-2 text-right tabular-nums">{r.order_count}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </section>
        </>
      )}
    </ReportPage>
  );
}
