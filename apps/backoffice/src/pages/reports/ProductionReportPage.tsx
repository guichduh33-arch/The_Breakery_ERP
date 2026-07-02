// apps/backoffice/src/pages/reports/ProductionReportPage.tsx
// S40 Wave B3 — Production report: KPI cards + by_product table + by_day table.

import { toLocalDateStr } from '@breakery/domain';
import type { CsvColumn } from '@breakery/domain';
import { ReportPage } from '@/features/reports/components/ReportPage.js';
import { DateRangePicker } from '@/features/reports/components/DateRangePicker.js';
import { ExportButtons } from '@/features/reports/components/ExportButtons.js';
import { DrilldownLink } from '@/features/reports/components/DrilldownLink.js';
import { useUrlState } from '@/hooks/useUrlState.js';
import {
  useProductionReport,
  type ProductionReportByProduct,
} from '@/features/reports/hooks/useProductionReport.js';

const csvColumns: CsvColumn<ProductionReportByProduct>[] = [
  { header: 'Product',       accessor: (r) => r.product_name, format: 'text' },
  { header: 'Runs',          accessor: (r) => r.runs,          format: 'number' },
  { header: 'Qty Produced',  accessor: (r) => r.qty_produced,  format: 'number' },
  { header: 'Qty Waste',     accessor: (r) => r.qty_waste,     format: 'number' },
  { header: 'Value (IDR)',   accessor: (r) => r.value,         format: 'idr-round100' },
];

function defaultStart(): string {
  return toLocalDateStr(new Date(Date.now() - 29 * 86_400_000));
}

export default function ProductionReportPage() {
  const [start, setStart] = useUrlState('start', defaultStart());
  const [end,   setEnd]   = useUrlState('end', toLocalDateStr(new Date()));

  const { data, isLoading, error } = useProductionReport({ start, end });

  const byProduct = data?.by_product ?? [];
  const byDay     = data?.by_day     ?? [];

  const fmtIdr = (v: number) =>
    v.toLocaleString('id-ID', { style: 'currency', currency: 'IDR', maximumFractionDigits: 0 });

  return (
    <ReportPage
      title="Production Report"
      subtitle="Daily production runs — produced quantities, waste, and value per product."
      isEmpty={!isLoading && !error && data !== undefined && byProduct.length === 0 && byDay.length === 0}
      emptyState={{
        title: 'No production',
        description: 'No production runs recorded for this period.',
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
              csv={{ rows: byProduct, columns: csvColumns, filename: `production-report-${start}_${end}` }}
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
          {/* KPI cards */}
          <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
            {[
              { label: 'Runs',           value: String(data.summary.runs) },
              { label: 'Total Produced', value: String(data.summary.total_produced) },
              { label: 'Total Waste',    value: String(data.summary.total_waste) },
              { label: 'Total Value',    value: fmtIdr(data.summary.total_value) },
            ].map(({ label, value }) => (
              <div key={label} className="rounded-lg border border-border-subtle bg-surface-raised p-4">
                <p className="text-xs text-text-secondary uppercase tracking-wide">{label}</p>
                <p className="mt-1 text-lg font-semibold tabular-nums">{value}</p>
              </div>
            ))}
          </div>

          {/* By-product table */}
          <div>
            <h2 className="mb-2 text-sm font-medium uppercase tracking-widest text-text-secondary">
              By Product
            </h2>
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-border-subtle text-text-secondary">
                  <th className="py-2 text-left">Product</th>
                  <th className="py-2 text-right">Runs</th>
                  <th className="py-2 text-right">Qty Produced</th>
                  <th className="py-2 text-right">Qty Waste</th>
                  <th className="py-2 text-right">Value (IDR)</th>
                </tr>
              </thead>
              <tbody>
                {byProduct.map((r) => (
                  <tr key={r.product_id} className="border-b border-border-subtle">
                    <td className="py-2 font-medium">
                      <DrilldownLink entity="product" id={r.product_id} label={r.product_name} icon={false} />
                    </td>
                    <td className="py-2 text-right tabular-nums">{r.runs}</td>
                    <td className="py-2 text-right tabular-nums">{r.qty_produced}</td>
                    <td className="py-2 text-right tabular-nums">{r.qty_waste}</td>
                    <td className="py-2 text-right tabular-nums">{fmtIdr(r.value)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {/* By-day table */}
          <div>
            <h2 className="mb-2 text-sm font-medium uppercase tracking-widest text-text-secondary">
              By Day
            </h2>
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-border-subtle text-text-secondary">
                  <th className="py-2 text-left">Date</th>
                  <th className="py-2 text-right">Qty Produced</th>
                  <th className="py-2 text-right">Qty Waste</th>
                  <th className="py-2 text-right">Value (IDR)</th>
                </tr>
              </thead>
              <tbody>
                {byDay.map((d) => (
                  <tr key={d.date} className="border-b border-border-subtle">
                    <td className="py-2 text-text-secondary">{d.date.slice(0, 10)}</td>
                    <td className="py-2 text-right tabular-nums">{d.qty_produced}</td>
                    <td className="py-2 text-right tabular-nums">{d.qty_waste}</td>
                    <td className="py-2 text-right tabular-nums">{fmtIdr(d.value)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </ReportPage>
  );
}
