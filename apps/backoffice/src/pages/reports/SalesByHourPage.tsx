// apps/backoffice/src/pages/reports/SalesByHourPage.tsx
//
// 24-bucket bar chart of revenue by hour, for a given business-local date.

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
import { Input } from '@breakery/ui';
import { toLocalDateStr } from '@breakery/domain';
import type { CsvColumn } from '@breakery/domain';
import { ReportPage } from '@/features/reports/components/ReportPage.js';
import { useSalesByHour } from '@/features/reports/hooks/useSalesByHour.js';
import { ExportButtons } from '@/features/reports/components/ExportButtons.js';

import type { SalesHourRow } from '@/features/reports/hooks/useSalesByHour.js';

const csvColumns: CsvColumn<SalesHourRow>[] = [
  { header: 'Hour',        accessor: (r) => r.hour,        format: 'number' },
  { header: 'Revenue',     accessor: (r) => r.total,       format: 'idr-round100' },
  { header: 'Order Count', accessor: (r) => r.order_count, format: 'number' },
];

export default function SalesByHourPage() {
  const [date, setDate] = useState<string>(() => toLocalDateStr(new Date()));
  const { data, isLoading, error } = useSalesByHour(date);

  return (
    <ReportPage
      title="Sales by Hour"
      subtitle="Revenue distribution across 24 hours of a single business day."
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
          {data && (
            <ExportButtons
              csv={{ rows: data, columns: csvColumns, filename: `sales-by-hour-${date}` }}
              pdf={{ template: 'sales_by_hour', data, period: { start: date, end: date }, filename: `sales-by-hour-${date}` }}
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
      {data !== undefined && data !== null && (
        <div className="h-96 w-full">
          <ResponsiveContainer width="100%" height="100%">
            <BarChart data={data} margin={{ top: 10, right: 20, bottom: 30, left: 0 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="#e5e7eb" />
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
              <Bar dataKey="total" fill="#c8a874" name="total" />
            </BarChart>
          </ResponsiveContainer>
        </div>
      )}
    </ReportPage>
  );
}
