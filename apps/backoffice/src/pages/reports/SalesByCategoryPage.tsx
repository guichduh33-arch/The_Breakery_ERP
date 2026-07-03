// apps/backoffice/src/pages/reports/SalesByCategoryPage.tsx
//
// Per-category revenue + quantity over a date window. Bar chart + table.

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
import { toLocalDateStr, previousPeriod } from '@breakery/domain';
import type { CsvColumn } from '@breakery/domain';
import { ReportPage } from '@/features/reports/components/ReportPage.js';
import { DateRangePickerWithCompare } from '@/features/reports/components/DateRangePickerWithCompare.js';
import { DeltaPct } from '@/features/reports/components/DeltaPct.js';
import { useSalesByCategory } from '@/features/reports/hooks/useSalesByCategory.js';
import type { SalesCategoryRow } from '@/features/reports/hooks/useSalesByCategory.js';
import { ExportButtons } from '@/features/reports/components/ExportButtons.js';
import { DrilldownLink } from '@/features/reports/components/DrilldownLink.js';
import { useUrlState, useUrlBoolean } from '@/hooks/useUrlState.js';

const csvColumns: CsvColumn<SalesCategoryRow>[] = [
  { header: 'Category', accessor: (r) => r.category_name, format: 'text' },
  { header: 'Revenue',  accessor: (r) => r.total,         format: 'idr-round100' },
  { header: 'Qty',      accessor: (r) => r.qty,           format: 'number' },
];

function defaultStart(): string {
  return toLocalDateStr(new Date(Date.now() - 6 * 86_400_000));
}

function sumRows(rows: SalesCategoryRow[]): { total: number; qty: number } {
  return rows.reduce(
    (acc, r) => ({ total: acc.total + r.total, qty: acc.qty + r.qty }),
    { total: 0, qty: 0 },
  );
}

export default function SalesByCategoryPage() {
  const [start, setStart] = useUrlState('start', defaultStart());
  const [end,   setEnd]   = useUrlState('end', toLocalDateStr(new Date()));
  const [compare, setCompare] = useUrlBoolean('compare');

  const prev = useMemo(() => compare ? previousPeriod(start, end) : null, [compare, start, end]);

  const { data, isLoading, error } = useSalesByCategory(start, end);
  const { data: prevData } = useSalesByCategory(
    prev?.start ?? start,
    prev?.end   ?? end,
  );

  const showDelta = compare && !!prevData;

  const currentSums = useMemo(() => data ? sumRows(data) : null, [data]);
  const prevSums    = useMemo(() => prevData ? sumRows(prevData) : null, [prevData]);

  return (
    <ReportPage
      title="Sales by Category"
      subtitle="Revenue + quantity grouped by product category."
      isEmpty={!isLoading && !error && data?.length === 0}
      emptyState={{
        title: 'No sales',
        description: 'No sales in the selected date range.',
      }}
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
              csv={{ rows: data, columns: csvColumns, filename: `sales-by-category-${start}_${end}` }}
              pdf={{
                template: 'sales_by_category',
                data,
                period: { start, end },
                filename: `sales-by-category-${start}_${end}`,
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
          <span className="font-medium text-text-secondary">vs prev. period:</span>
          <span>
            Revenue&nbsp;
            <DeltaPct current={currentSums.total} previous={prevSums.total} />
          </span>
          <span>
            Qty&nbsp;
            <DeltaPct current={currentSums.qty} previous={prevSums.qty} />
          </span>
        </div>
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
                <Bar dataKey="total" fill="var(--gold-base, #c8a874)" />
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
              {data.map((r) => (
                <tr key={r.category_id} className="border-b border-border-subtle">
                  <td className="py-2">
                    <DrilldownLink
                      entity="category"
                      id={r.category_id}
                      label={r.category_name}
                      filter={{ date_from: start, date_to: end }}
                      icon={false}
                    />
                  </td>
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
