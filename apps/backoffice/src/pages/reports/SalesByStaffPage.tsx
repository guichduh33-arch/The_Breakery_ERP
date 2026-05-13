// apps/backoffice/src/pages/reports/SalesByStaffPage.tsx
//
// Table of revenue / order count / avg basket per staff member over a date
// range. No chart — table is the primary view here.

import { useState } from 'react';
import { toLocalDateStr } from '@breakery/domain';
import { ReportPage } from '@/features/reports/components/ReportPage.js';
import { DateRangePicker } from '@/features/reports/components/DateRangePicker.js';
import { useSalesByStaff } from '@/features/reports/hooks/useSalesByStaff.js';

function defaultStart(): string {
  return toLocalDateStr(new Date(Date.now() - 6 * 86_400_000));
}

export default function SalesByStaffPage() {
  const [start, setStart] = useState<string>(defaultStart);
  const [end,   setEnd]   = useState<string>(() => toLocalDateStr(new Date()));
  const { data, isLoading, error } = useSalesByStaff(start, end);

  return (
    <ReportPage
      title="Sales by Staff"
      subtitle="Revenue, order count, and average basket per cashier."
      filters={
        <DateRangePicker
          start={start}
          end={end}
          onStartChange={setStart}
          onEndChange={setEnd}
        />
      }
    >
      {isLoading && <p className="text-sm text-text-secondary">Loading…</p>}
      {error && (
        <p className="text-sm text-red-500" role="alert">
          {error.message ?? 'Failed to load report.'}
        </p>
      )}
      {data !== undefined && data !== null && (
        <table className="w-full text-sm">
          <thead>
            <tr className="text-text-secondary border-b border-border-subtle">
              <th className="py-2 text-left">Staff</th>
              <th className="py-2 text-right">Total</th>
              <th className="py-2 text-right">Orders</th>
              <th className="py-2 text-right">Avg Basket</th>
            </tr>
          </thead>
          <tbody>
            {data.length === 0 && (
              <tr>
                <td className="py-3 text-text-secondary" colSpan={4}>
                  No sales in the selected range.
                </td>
              </tr>
            )}
            {data.map((r) => (
              <tr key={r.staff_id} className="border-b border-border-subtle">
                <td className="py-2">{r.staff_name}</td>
                <td className="py-2 text-right tabular-nums">{r.total.toLocaleString()}</td>
                <td className="py-2 text-right tabular-nums">{r.order_count}</td>
                <td className="py-2 text-right tabular-nums">
                  {Math.round(r.avg_basket).toLocaleString()}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </ReportPage>
  );
}
