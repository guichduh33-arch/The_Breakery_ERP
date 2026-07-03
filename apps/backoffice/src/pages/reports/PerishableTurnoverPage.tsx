// apps/backoffice/src/pages/reports/PerishableTurnoverPage.tsx
// S30 Wave 4.2 — Perishable lot turnover report with velocity score visual.

import { toLocalDateStr } from '@breakery/domain';
import type { CsvColumn } from '@breakery/domain';
import { ReportPage } from '@/features/reports/components/ReportPage.js';
import { DateRangePicker } from '@/features/reports/components/DateRangePicker.js';
import { ExportButtons } from '@/features/reports/components/ExportButtons.js';
import { DrilldownLink } from '@/features/reports/components/DrilldownLink.js';
import { useUrlState } from '@/hooks/useUrlState.js';
import {
  usePerishableTurnover,
  type PerishableTurnoverLine,
} from '@/features/reports/hooks/usePerishableTurnover.js';

const csvColumns: CsvColumn<PerishableTurnoverLine>[] = [
  { header: 'Product',          accessor: (r) => r.product_name,       format: 'text' },
  { header: 'Lots',             accessor: (r) => r.lots_count,         format: 'number' },
  { header: 'Consumed qty',     accessor: (r) => r.consumed_qty,       format: 'number' },
  { header: 'Expired qty',      accessor: (r) => r.expired_qty,        format: 'number' },
  { header: 'Active qty',       accessor: (r) => r.current_active_qty, format: 'number' },
  { header: 'Waste %',          accessor: (r) => r.waste_pct / 100,    format: 'percent' },
  { header: 'Avg days in stock', accessor: (r) => r.avg_days_in_stock ?? 0, format: 'number' },
  { header: 'Velocity score',   accessor: (r) => r.velocity_score,     format: 'number' },
];

function defaultStart(): string {
  return toLocalDateStr(new Date(Date.now() - 29 * 86_400_000));
}

/** Render filled/empty star characters for a 0–5 velocity score. */
function VelocityStars({ score }: { score: number }) {
  const filled = Math.max(0, Math.min(5, Math.round(score)));
  return (
    <span className="text-amber-500" title={`Velocity: ${score.toFixed(1)}/5`}>
      {'★'.repeat(filled)}
      <span className="text-text-secondary">{'☆'.repeat(5 - filled)}</span>
    </span>
  );
}

function wasteTone(pct: number): string {
  if (pct > 20) return 'text-red-600 font-semibold';
  if (pct > 10) return 'text-amber-600';
  return 'text-emerald-600';
}

export default function PerishableTurnoverPage() {
  const [start, setStart] = useUrlState('start', defaultStart());
  const [end,   setEnd]   = useUrlState('end', toLocalDateStr(new Date()));

  const { data, isLoading, error } = usePerishableTurnover({ start, end });

  const rows = data?.by_product ?? [];

  return (
    <ReportPage
      title="Perishable Turnover"
      subtitle="Lot consumption, expiry, and velocity for perishable products."
      isEmpty={!isLoading && !error && data !== undefined && rows.length === 0}
      emptyState={{
        title: 'No perishable data',
        description: 'No perishable lot data for this period.',
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
              csv={{ rows, columns: csvColumns, filename: `perishable-turnover-${start}_${end}` }}
              pdf={{
                template: 'perishable_turnover',
                data,
                period: { start, end },
                filename: `perishable-turnover-${start}_${end}`,
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
              <th className="py-2 text-right">Lots</th>
              <th className="py-2 text-right">Consumed</th>
              <th className="py-2 text-right">Expired</th>
              <th className="py-2 text-right">Active</th>
              <th className="py-2 text-right">Waste %</th>
              <th className="py-2 text-right">Avg days</th>
              <th className="py-2 text-left">Velocity</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.product_id} className="border-b border-border-subtle">
                <td className="py-2 font-medium">
                  <DrilldownLink entity="product" id={r.product_id} label={r.product_name} icon={false} />
                </td>
                <td className="py-2 text-right tabular-nums">{r.lots_count}</td>
                <td className="py-2 text-right tabular-nums">{r.consumed_qty}</td>
                <td className="py-2 text-right tabular-nums">{r.expired_qty}</td>
                <td className="py-2 text-right tabular-nums">{r.current_active_qty}</td>
                <td className={`py-2 text-right tabular-nums ${wasteTone(r.waste_pct)}`}>
                  {r.waste_pct.toFixed(1)}%
                </td>
                <td className="py-2 text-right tabular-nums text-text-secondary">
                  {r.avg_days_in_stock ?? '—'}
                </td>
                <td className="py-2">
                  <VelocityStars score={r.velocity_score} />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </ReportPage>
  );
}
