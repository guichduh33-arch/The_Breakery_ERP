// apps/backoffice/src/pages/reports/StaffPerformancePage.tsx
// S40 Wave B1 — Staff orders / revenue / voids / refunds / discounts breakdown.

import { toLocalDateStr } from '@breakery/domain';
import type { CsvColumn } from '@breakery/domain';
import { ReportPage } from '@/features/reports/components/ReportPage.js';
import { DateRangePicker } from '@/features/reports/components/DateRangePicker.js';
import { ExportButtons } from '@/features/reports/components/ExportButtons.js';
import { useUrlState } from '@/hooks/useUrlState.js';
import {
  useStaffPerformance,
  type StaffPerformanceRow,
} from '@/features/reports/hooks/useStaffPerformance.js';

const csvColumns: CsvColumn<StaffPerformanceRow>[] = [
  { header: 'Staff',                 accessor: (r) => r.staff_name,            format: 'text' },
  { header: 'Orders',               accessor: (r) => r.orders_served,         format: 'number' },
  { header: 'Revenue (IDR)',        accessor: (r) => r.revenue,               format: 'idr-round100' },
  { header: 'AOV (IDR)',            accessor: (r) => r.aov,                   format: 'idr-round100' },
  { header: 'Items per Order',      accessor: (r) => r.items_per_order,       format: 'number' },
  { header: 'Voids Count',         accessor: (r) => r.voids_count,           format: 'number' },
  { header: 'Voids Value (IDR)',   accessor: (r) => r.voids_value,           format: 'idr-round100' },
  { header: 'Refunds Count',       accessor: (r) => r.refunds_count,         format: 'number' },
  { header: 'Refunds Value (IDR)', accessor: (r) => r.refunds_value,         format: 'idr-round100' },
  { header: 'Discount Orders',     accessor: (r) => r.discount_orders_count, format: 'number' },
  { header: 'Discount Value (IDR)', accessor: (r) => r.discount_value,       format: 'idr-round100' },
  { header: 'Items Cancelled',     accessor: (r) => r.items_cancelled,       format: 'number' },
];

const IDR = (v: number) =>
  v.toLocaleString('id-ID', { style: 'currency', currency: 'IDR', maximumFractionDigits: 0 });

function defaultStart(): string {
  return toLocalDateStr(new Date(Date.now() - 29 * 86_400_000));
}

export default function StaffPerformancePage() {
  const [start, setStart] = useUrlState('start', defaultStart());
  const [end,   setEnd]   = useUrlState('end', toLocalDateStr(new Date()));

  const { data, isLoading, error } = useStaffPerformance({ start, end });

  const rows = data?.by_staff ?? [];

  return (
    <ReportPage
      title="Staff Performance"
      subtitle="Per-staff orders, revenue, voids, refunds, discounts and cancellations."
      isEmpty={!isLoading && !error && data !== undefined && rows.length === 0}
      emptyState={{
        title: 'No performance data',
        description: 'No staff performance data for this period.',
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
              csv={{ rows, columns: csvColumns, filename: `staff-performance-${start}_${end}` }}
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

      {data && (
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-border-subtle text-text-secondary">
                <th className="py-2 text-left">Staff</th>
                <th className="py-2 text-right">Orders</th>
                <th className="py-2 text-right">Revenue</th>
                <th className="py-2 text-right">AOV</th>
                <th className="py-2 text-right">Items/order</th>
                <th className="py-2 text-right">Voids</th>
                <th className="py-2 text-right">Voids (IDR)</th>
                <th className="py-2 text-right">Refunds</th>
                <th className="py-2 text-right">Refunds (IDR)</th>
                <th className="py-2 text-right">Disc. orders</th>
                <th className="py-2 text-right">Disc. (IDR)</th>
                <th className="py-2 text-right">Items cancelled</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.staff_id} className="border-b border-border-subtle">
                  <td className="py-2 font-medium">{r.staff_name}</td>
                  <td className="py-2 text-right tabular-nums">{r.orders_served}</td>
                  <td className="py-2 text-right tabular-nums">{IDR(r.revenue)}</td>
                  <td className="py-2 text-right tabular-nums">{IDR(r.aov)}</td>
                  <td className="py-2 text-right tabular-nums">{r.items_per_order.toFixed(1)}</td>
                  <td className="py-2 text-right tabular-nums">{r.voids_count}</td>
                  <td className="py-2 text-right tabular-nums">{IDR(r.voids_value)}</td>
                  <td className="py-2 text-right tabular-nums">{r.refunds_count}</td>
                  <td className="py-2 text-right tabular-nums">{IDR(r.refunds_value)}</td>
                  <td className="py-2 text-right tabular-nums">{r.discount_orders_count}</td>
                  <td className="py-2 text-right tabular-nums">{IDR(r.discount_value)}</td>
                  <td className="py-2 text-right tabular-nums">{r.items_cancelled}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </ReportPage>
  );
}
