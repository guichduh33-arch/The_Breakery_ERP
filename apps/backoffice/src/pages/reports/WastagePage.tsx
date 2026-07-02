// apps/backoffice/src/pages/reports/WastagePage.tsx
// S30 Wave 4.2 — Wastage report page with date range filter + export.

import { toLocalDateStr } from '@breakery/domain';
import type { CsvColumn } from '@breakery/domain';
import { ReportPage } from '@/features/reports/components/ReportPage.js';
import { DateRangePicker } from '@/features/reports/components/DateRangePicker.js';
import { ExportButtons } from '@/features/reports/components/ExportButtons.js';
import { DrilldownLink } from '@/features/reports/components/DrilldownLink.js';
import { useUrlState } from '@/hooks/useUrlState.js';
import {
  useWastageReport,
  type WastageReportLine,
} from '@/features/reports/hooks/useWastageReport.js';

const csvColumns: CsvColumn<WastageReportLine>[] = [
  { header: 'Product',    accessor: (r) => r.product_name, format: 'text' },
  { header: 'Type',       accessor: (r) => r.type,         format: 'text' },
  { header: 'Qty',        accessor: (r) => r.qty,          format: 'number' },
  { header: 'Value (IDR)', accessor: (r) => r.value,       format: 'idr-round100' },
  { header: 'Date',       accessor: (r) => r.created_at,   format: 'datetime' },
];

function defaultStart(): string {
  return toLocalDateStr(new Date(Date.now() - 29 * 86_400_000));
}

export default function WastagePage() {
  const [start, setStart] = useUrlState('start', defaultStart());
  const [end,   setEnd]   = useUrlState('end', toLocalDateStr(new Date()));

  const { data, isLoading, error } = useWastageReport({ start, end });

  const lines = data?.lines ?? [];

  return (
    <ReportPage
      title="Wastage"
      subtitle="Waste and expired stock recorded across a date range."
      isEmpty={!isLoading && !error && data !== undefined && lines.length === 0}
      emptyState={{
        title: 'No wastage',
        description: 'No wastage recorded for this period.',
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
              csv={{ rows: lines, columns: csvColumns, filename: `wastage-${start}_${end}` }}
              pdf={{
                template: 'wastage',
                data,
                period: { start, end },
                filename: `wastage-${start}_${end}`,
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
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-border-subtle text-text-secondary">
              <th className="py-2 text-left">Product</th>
              <th className="py-2 text-left">Type</th>
              <th className="py-2 text-right">Qty</th>
              <th className="py-2 text-right">Value (IDR)</th>
              <th className="py-2 text-left">Date</th>
            </tr>
          </thead>
          <tbody>
            {lines.map((r) => (
              <tr key={r.id} className="border-b border-border-subtle">
                <td className="py-2 font-medium">
                  <DrilldownLink entity="product" id={r.product_id} label={r.product_name} icon={false} />
                </td>
                <td className="py-2 text-text-secondary">{r.type}</td>
                <td className="py-2 text-right tabular-nums">{r.qty}</td>
                <td className="py-2 text-right tabular-nums">
                  {r.value.toLocaleString('id-ID', { style: 'currency', currency: 'IDR', maximumFractionDigits: 0 })}
                </td>
                <td className="py-2 text-text-secondary">{r.created_at.slice(0, 10)}</td>
              </tr>
            ))}
          </tbody>
          {lines.length > 0 && (
            <tfoot>
              <tr className="border-t border-border-subtle font-semibold">
                <td className="py-2" colSpan={3}>Total wastage value</td>
                <td className="py-2 text-right tabular-nums">
                  {(data.total_value ?? 0).toLocaleString('id-ID', { style: 'currency', currency: 'IDR', maximumFractionDigits: 0 })}
                </td>
                <td />
              </tr>
            </tfoot>
          )}
        </table>
      )}
    </ReportPage>
  );
}
