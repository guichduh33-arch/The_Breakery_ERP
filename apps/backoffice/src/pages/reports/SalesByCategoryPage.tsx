// apps/backoffice/src/pages/reports/SalesByCategoryPage.tsx
//
// Per-category revenue + quantity over a date window. Bar chart + table.

import { useState } from 'react';
import {
  BarChart,
  Bar,
  CartesianGrid,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import { toLocalDateStr } from '@breakery/domain';
import { ReportPage } from '@/features/reports/components/ReportPage.js';
import { DateRangePicker } from '@/features/reports/components/DateRangePicker.js';
import { useSalesByCategory } from '@/features/reports/hooks/useSalesByCategory.js';

function defaultStart(): string {
  return toLocalDateStr(new Date(Date.now() - 6 * 86_400_000));
}

export default function SalesByCategoryPage() {
  const [start, setStart] = useState<string>(defaultStart);
  const [end,   setEnd]   = useState<string>(() => toLocalDateStr(new Date()));
  const { data, isLoading, error } = useSalesByCategory(start, end);

  return (
    <ReportPage
      title="Sales by Category"
      subtitle="Revenue + quantity grouped by product category."
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
        <div className="space-y-6">
          <div className="h-72 w-full">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={data} margin={{ top: 10, right: 20, bottom: 50, left: 0 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="#e5e7eb" />
                <XAxis dataKey="category_name" angle={-25} textAnchor="end" interval={0} />
                <YAxis />
                <Tooltip />
                <Bar dataKey="total" fill="#c8a874" />
              </BarChart>
            </ResponsiveContainer>
          </div>
          <table className="w-full text-sm">
            <thead>
              <tr className="text-text-secondary border-b border-border-subtle">
                <th className="py-2 text-left">Category</th>
                <th className="py-2 text-right">Total</th>
                <th className="py-2 text-right">Qty</th>
              </tr>
            </thead>
            <tbody>
              {data.length === 0 && (
                <tr>
                  <td className="py-3 text-text-secondary" colSpan={3}>
                    No sales in the selected range.
                  </td>
                </tr>
              )}
              {data.map((r) => (
                <tr key={r.category_id} className="border-b border-border-subtle">
                  <td className="py-2">{r.category_name}</td>
                  <td className="py-2 text-right tabular-nums">{r.total.toLocaleString()}</td>
                  <td className="py-2 text-right tabular-nums">{r.qty}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </ReportPage>
  );
}
