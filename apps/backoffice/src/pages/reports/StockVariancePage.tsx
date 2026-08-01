// apps/backoffice/src/pages/reports/StockVariancePage.tsx
//
// Per-product variance table with color-coded variance column. Window
// defaults to the last 30 days. Section filter optional.
//
// Audit Reports 2026-08-01 :
//   R-01 — les bornes étaient recalculées à chaque render via `Date.now()` et
//     `new Date().toISOString()` (précision milliseconde). Elles entraient dans
//     la queryKey, qui changeait donc à chaque render : la page bouclait en
//     requêtes. Les bornes sont désormais ancrées au JOUR local
//     (`toLocalDateStr` → `toLocalDayStartUTC`) et mémoïsées.
//   R-05 — la fenêtre était figée à 30 j sans UI (`useState(30)` sans setter) et
//     `p_section_id` n'était jamais transmis alors que le hook et la RPC le
//     supportent. Les deux filtres sont exposés, en URL-state (convention S57).

import { useMemo } from 'react';
import { cn, selectClassName } from '@breakery/ui';
import { toLocalDateStr, toLocalDayStartUTC, toLocalDayEndUTC } from '@breakery/domain';
import type { CsvColumn } from '@breakery/domain';
import { ReportPage } from '@/features/reports/components/ReportPage.js';
import { DateRangePicker } from '@/features/reports/components/DateRangePicker.js';
import {
  useStockVariance,
  type StockVarianceRow,
} from '@/features/reports/hooks/useStockVariance.js';
import { useSections } from '@/features/inventory-transfers/hooks/useSections.js';
import { ExportButtons } from '@/features/reports/components/ExportButtons.js';
import { DrilldownLink } from '@/features/reports/components/DrilldownLink.js';
import { useUrlState } from '@/hooks/useUrlState.js';

const csvColumns: CsvColumn<StockVarianceRow>[] = [
  { header: 'Product',      accessor: (r) => r.product_name,  format: 'text' },
  { header: 'SKU',          accessor: (r) => r.sku,           format: 'text' },
  { header: 'Opened',       accessor: (r) => r.opened,        format: 'number' },
  { header: 'Sold',         accessor: (r) => r.sold,          format: 'number' },
  { header: 'Adjusted',     accessor: (r) => r.adjusted,      format: 'number' },
  { header: 'Current',      accessor: (r) => r.current_qty,   format: 'number' },
  { header: 'Expected',     accessor: (r) => r.expected,      format: 'number' },
  { header: 'Variance',     accessor: (r) => r.variance,      format: 'number' },
  { header: 'Variance %',   accessor: (r) => r.variance_pct,  format: 'number' },
];

function varianceTone(v: number): string {
  if (v === 0) return 'text-text-primary';
  if (v > 0)   return 'text-success';      // surplus (positive)
  if (v < -5)  return 'text-danger font-semibold';
  return 'text-warning';                     // small loss
}

function defaultStart(): string {
  return toLocalDateStr(new Date(Date.now() - 29 * 86_400_000));
}

export default function StockVariancePage() {
  const [start,     setStart]     = useUrlState('start', defaultStart());
  const [end,       setEnd]       = useUrlState('end', toLocalDateStr(new Date()));
  const [sectionId, setSectionId] = useUrlState('section_id', '');

  const { data: sections } = useSections();

  // La RPC attend des TIMESTAMPTZ et compare en BETWEEN (inclusif). On convertit
  // les dates métier locales en bornes UTC ancrées au jour : pour un même couple
  // (start, end) la valeur est identique d'un render à l'autre, donc la queryKey
  // est stable — c'est le cœur du correctif R-01.
  const filters = useMemo(() => {
    const f: { dateStart: string; dateEnd: string; sectionId?: string } = {
      dateStart: toLocalDayStartUTC(start).toISOString(),
      dateEnd:   toLocalDayEndUTC(end).toISOString(),
    };
    if (sectionId) f.sectionId = sectionId;
    return f;
  }, [start, end, sectionId]);

  const { data, isLoading, error } = useStockVariance(filters);

  return (
    <ReportPage
      title="Stock Variance"
      subtitle="Expected vs current stock per product. Positive = surplus, negative = shrinkage."
      isEmpty={!isLoading && !error && data?.length === 0}
      emptyState={{
        title: 'No movement',
        description: 'No stock movement for the selected period and section.',
      }}
      filters={
        <div className="flex flex-wrap items-center gap-3">
          <DateRangePicker
            start={start}
            end={end}
            onStartChange={setStart}
            onEndChange={setEnd}
          />
          {/* Native <select> — @breakery/ui does not export a Select component */}
          <label className="flex items-center gap-2 text-sm text-text-secondary">
            <span>Section</span>
            <select
              className={cn(selectClassName, 'h-9 w-auto')}
              value={sectionId}
              onChange={(e) => setSectionId(e.target.value)}
              aria-label="Filter by section"
            >
              <option value="">All sections</option>
              {(sections ?? []).map((s) => (
                <option key={s.id} value={s.id}>{s.name}</option>
              ))}
            </select>
          </label>
          {data != null && (
            <ExportButtons
              csv={{ rows: data, columns: csvColumns, filename: `stock-variance-${start}_${end}` }}
              pdf={{ template: 'stock_variance', data, period: { start, end }, filename: `stock-variance-${start}_${end}` }}
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
      {data !== undefined && data !== null && (
        <table className="w-full text-sm">
          <thead>
            <tr className="text-text-secondary border-b border-border-subtle">
              <th className="py-2 text-left">Product</th>
              <th className="py-2 text-right">Opened</th>
              <th className="py-2 text-right">Sold</th>
              <th className="py-2 text-right">Adjusted</th>
              <th className="py-2 text-right">Current</th>
              <th className="py-2 text-right">Expected</th>
              <th className="py-2 text-right">Variance</th>
              <th className="py-2 text-right">%</th>
            </tr>
          </thead>
          <tbody>
            {data.map((r: StockVarianceRow) => (
              <tr key={r.product_id} className="border-b border-border-subtle">
                <td className="py-2">
                  <div className="font-medium">
                    <DrilldownLink entity="product" id={r.product_id} label={r.product_name} icon={false} />
                  </div>
                  <div className="text-xs text-text-secondary">{r.sku}</div>
                </td>
                <td className="py-2 text-right tabular-nums">{r.opened}</td>
                <td className="py-2 text-right tabular-nums">{r.sold}</td>
                <td className="py-2 text-right tabular-nums">{r.adjusted}</td>
                <td className="py-2 text-right tabular-nums">{r.current_qty}</td>
                <td className="py-2 text-right tabular-nums">{r.expected}</td>
                <td className={cn('py-2 text-right tabular-nums', varianceTone(r.variance))}>
                  {r.variance > 0 ? `+${r.variance}` : r.variance}
                </td>
                <td className={cn('py-2 text-right tabular-nums', varianceTone(r.variance))}>
                  {r.variance_pct.toFixed(1)}%
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </ReportPage>
  );
}
