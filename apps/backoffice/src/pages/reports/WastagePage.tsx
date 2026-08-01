// apps/backoffice/src/pages/reports/WastagePage.tsx
// S30 Wave 4.2 — Wastage report page with date range filter + export.

import { toLocalDateStr } from '@breakery/domain';
import type { CsvColumn } from '@breakery/domain';
import { ReportPage } from '@/features/reports/components/ReportPage.js';
import { ChartCard } from '@/features/reports/components/ChartCard.js';
import { DateRangePicker } from '@/features/reports/components/DateRangePicker.js';
import { ExportButtons } from '@/features/reports/components/ExportButtons.js';
import { DrilldownLink } from '@/features/reports/components/DrilldownLink.js';
import { useUrlState } from '@/hooks/useUrlState.js';
import { formatIdrFull, familyColor } from '@/features/reports/utils/chartColors.js';
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

  const lines     = data?.lines ?? [];
  const byProduct = data?.by_product ?? [];
  const maxValue  = byProduct.reduce((m, r) => Math.max(m, r.total_value), 0) || 1;

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
        <p className="text-sm text-danger" role="alert">
          {error.message ?? 'Failed to load report.'}
        </p>
      )}
      {data?.truncated && (
        <p
          className="mb-3 rounded border border-warning/30 bg-warning-soft px-3 py-2 text-sm text-warning"
          role="status"
          data-testid="wastage-truncated-banner"
        >
          First 500 lines shown — narrow the date range to see them all. The total
          below still covers the whole period.
        </p>
      )}
      {data && byProduct.length > 0 && (
        <ChartCard
          title="By product"
          subtitle="Manual waste vs auto spoilage, ranked by value lost"
          className="mb-6"
          aside={
            <span className="text-xs text-text-muted">
              manual {formatIdrFull(data.manual_value)} · spoilage {formatIdrFull(data.spoilage_value)}
            </span>
          }
        >
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-border-subtle text-text-secondary">
                <th className="py-2 text-left">Product</th>
                <th className="py-2 text-right">Manual</th>
                <th className="py-2 text-right">Spoilage</th>
                <th className="py-2 text-right">Total</th>
                <th className="py-2 pl-4 text-left">Share</th>
              </tr>
            </thead>
            <tbody>
              {byProduct.map((r) => (
                <tr key={r.product_id} className="border-b border-border-subtle">
                  <td className="py-2 font-medium">
                    <DrilldownLink entity="product" id={r.product_id} label={r.product_name} icon={false} />
                  </td>
                  <td className="py-2 text-right tabular-nums text-text-secondary">
                    {r.manual_waste_value > 0 ? formatIdrFull(r.manual_waste_value) : '—'}
                  </td>
                  <td className="py-2 text-right tabular-nums text-text-secondary">
                    {r.spoilage_value > 0 ? formatIdrFull(r.spoilage_value) : '—'}
                  </td>
                  <td className="py-2 text-right tabular-nums font-medium">
                    {formatIdrFull(r.total_value)}
                  </td>
                  <td className="py-2 pl-4">
                    {/* Barre empilée : manuel puis péremption, proportionnelles au
                        pire produit de la période. */}
                    <div className="flex h-2 w-full overflow-hidden rounded-sm bg-surface-4">
                      <div
                        className="h-full"
                        style={{
                          width: `${(r.manual_waste_value / maxValue) * 100}%`,
                          backgroundColor: familyColor('opex', 0),
                        }}
                      />
                      <div
                        className="h-full"
                        style={{
                          width: `${(r.spoilage_value / maxValue) * 100}%`,
                          backgroundColor: familyColor('cogs', 0),
                        }}
                      />
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </ChartCard>
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
