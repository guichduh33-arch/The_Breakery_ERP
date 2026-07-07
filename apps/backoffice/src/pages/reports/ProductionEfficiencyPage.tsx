// apps/backoffice/src/pages/reports/ProductionEfficiencyPage.tsx
// S40 Wave B3 — Production efficiency: yield variance % (colored) + waste rate by product + by_day trend.

import { toLocalDateStr } from '@breakery/domain';
import type { CsvColumn } from '@breakery/domain';
import { ReportPage } from '@/features/reports/components/ReportPage.js';
import { DateRangePicker } from '@/features/reports/components/DateRangePicker.js';
import { ExportButtons } from '@/features/reports/components/ExportButtons.js';
import { DrilldownLink } from '@/features/reports/components/DrilldownLink.js';
import { useUrlState } from '@/hooks/useUrlState.js';
import {
  useProductionEfficiency,
  type ProductionEfficiencyByProduct,
} from '@/features/reports/hooks/useProductionEfficiency.js';

const csvColumns: CsvColumn<ProductionEfficiencyByProduct>[] = [
  { header: 'Product',                    accessor: (r) => r.product_name,            format: 'text' },
  { header: 'Runs',                       accessor: (r) => r.runs,                    format: 'number' },
  { header: 'Avg Yield Variance (%)',     accessor: (r) => r.avg_yield_variance_pct ?? '', format: 'text' },
  { header: 'Worst Variance (%)',         accessor: (r) => r.worst_variance_pct ?? '',     format: 'text' },
  { header: 'Waste Rate (%)',             accessor: (r) => r.waste_rate_pct ?? '',          format: 'text' },
  { header: 'Has Variance Reasons',       accessor: (r) => r.has_variance_reasons ? 'Yes' : 'No', format: 'text' },
];

function defaultStart(): string {
  return toLocalDateStr(new Date(Date.now() - 29 * 86_400_000));
}

/** Colour class for a yield variance percentage value.
 *  < -10 → red (underperforming), >= 0 → green, otherwise neutral. */
function varianceClass(pct: number | null): string {
  if (pct === null) return 'text-text-secondary';
  if (pct < -10)   return 'text-danger font-medium';
  if (pct >= 0)    return 'text-success font-medium';
  return 'text-text-primary';
}

function fmtPct(pct: number | null): string {
  if (pct === null) return '—';
  return `${pct >= 0 ? '+' : ''}${pct.toFixed(1)}%`;
}

export default function ProductionEfficiencyPage() {
  const [start, setStart] = useUrlState('start', defaultStart());
  const [end,   setEnd]   = useUrlState('end', toLocalDateStr(new Date()));

  const { data, isLoading, error } = useProductionEfficiency({ start, end });

  const byProduct = data?.by_product ?? [];
  const byDay     = data?.by_day     ?? [];

  return (
    <ReportPage
      title="Production Efficiency"
      subtitle="Yield variance and waste rate per product across a date range."
      isEmpty={!isLoading && !error && data !== undefined && byProduct.length === 0 && byDay.length === 0}
      emptyState={{
        title: 'No production data',
        description: 'No production efficiency data for this period.',
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
              csv={{ rows: byProduct, columns: csvColumns, filename: `production-efficiency-${start}_${end}` }}
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
        <div className="space-y-6">
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
                  <th className="py-2 text-right">Avg Yield Var.</th>
                  <th className="py-2 text-right">Worst Var.</th>
                  <th className="py-2 text-right">Waste Rate</th>
                  <th className="py-2 text-center">Reasons</th>
                </tr>
              </thead>
              <tbody>
                {byProduct.map((r) => (
                  <tr key={r.product_id} className="border-b border-border-subtle">
                    <td className="py-2 font-medium">
                      <DrilldownLink entity="product" id={r.product_id} label={r.product_name} icon={false} />
                    </td>
                    <td className="py-2 text-right tabular-nums">{r.runs}</td>
                    <td className={`py-2 text-right tabular-nums ${varianceClass(r.avg_yield_variance_pct)}`}>
                      {fmtPct(r.avg_yield_variance_pct)}
                    </td>
                    <td className={`py-2 text-right tabular-nums ${varianceClass(r.worst_variance_pct)}`}>
                      {fmtPct(r.worst_variance_pct)}
                    </td>
                    <td className="py-2 text-right tabular-nums text-text-secondary">
                      {r.waste_rate_pct === null ? '—' : `${r.waste_rate_pct.toFixed(1)}%`}
                    </td>
                    <td className="py-2 text-center text-text-secondary">
                      {r.has_variance_reasons ? 'Yes' : '—'}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {/* By-day trend table */}
          <div>
            <h2 className="mb-2 text-sm font-medium uppercase tracking-widest text-text-secondary">
              Daily Trend
            </h2>
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-border-subtle text-text-secondary">
                  <th className="py-2 text-left">Date</th>
                  <th className="py-2 text-right">Avg Yield Var.</th>
                  <th className="py-2 text-right">Waste Rate</th>
                </tr>
              </thead>
              <tbody>
                {byDay.map((d) => (
                  <tr key={d.date} className="border-b border-border-subtle">
                    <td className="py-2 text-text-secondary">{d.date.slice(0, 10)}</td>
                    <td className={`py-2 text-right tabular-nums ${varianceClass(d.avg_yield_variance_pct)}`}>
                      {fmtPct(d.avg_yield_variance_pct)}
                    </td>
                    <td className="py-2 text-right tabular-nums text-text-secondary">
                      {d.waste_rate_pct === null ? '—' : `${d.waste_rate_pct.toFixed(1)}%`}
                    </td>
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
