// apps/backoffice/src/pages/reports/BasketAnalysisPage.tsx
//
// Market-basket analysis: top product pairs frequently bought together.
// Sorted by lift; high-lift rows highlighted.

import { useState } from 'react';
import { toLocalDateStr } from '@breakery/domain';
import type { CsvColumn } from '@breakery/domain';
import { Input } from '@breakery/ui';
import { ReportPage } from '@/features/reports/components/ReportPage.js';
import { DateRangePicker } from '@/features/reports/components/DateRangePicker.js';
import { useBasketAnalysis } from '@/features/reports/hooks/useBasketAnalysis.js';
import type { BasketPair } from '@/features/reports/hooks/useBasketAnalysis.js';
import { ExportButtons } from '@/features/reports/components/ExportButtons.js';
import { DrilldownLink } from '@/features/reports/components/DrilldownLink.js';
import { useUrlState } from '@/hooks/useUrlState.js';

const csvColumns: CsvColumn<BasketPair>[] = [
  { header: 'Product A',    accessor: (r) => r.product_a_name,      format: 'text' },
  { header: 'Product B',    accessor: (r) => r.product_b_name,      format: 'text' },
  { header: 'Co-occurrence',accessor: (r) => r.co_occurrence_count, format: 'number' },
  { header: 'Confidence',   accessor: (r) => r.confidence,          format: 'percent' },
  { header: 'Lift',         accessor: (r) => r.lift.toFixed(2),     format: 'text' },
];

function defaultStart(): string {
  return toLocalDateStr(new Date(Date.now() - 29 * 86_400_000));
}

export default function BasketAnalysisPage() {
  const [start, setStart] = useUrlState('start', defaultStart());
  const [end,   setEnd]   = useUrlState('end', toLocalDateStr(new Date()));
  const [topN,  setTopN]  = useState<number>(10);
  const { data, isLoading, error } = useBasketAnalysis(start, end, topN);

  return (
    <ReportPage
      title="Basket Analysis"
      subtitle="Product pairs frequently bought together — sorted by lift (cross-sell opportunities)."
      isEmpty={!isLoading && !error && data?.length === 0}
      emptyState={{
        title: 'No paired sales',
        description: 'No paired sales in the selected range.',
      }}
      filters={
        <div className="flex items-center gap-3">
          <DateRangePicker
            start={start}
            end={end}
            onStartChange={setStart}
            onEndChange={setEnd}
          />
          <label className="flex items-center gap-1 text-sm text-text-secondary">
            <span>Top N</span>
            <Input
              type="number"
              min={1}
              max={100}
              value={topN}
              onChange={(e) => {
                const n = Number(e.target.value);
                if (Number.isFinite(n) && n >= 1) setTopN(Math.min(100, Math.max(1, n)));
              }}
              className="h-9 w-20"
              aria-label="Top N"
            />
          </label>
          {data && (
            <ExportButtons
              csv={{ rows: data, columns: csvColumns, filename: `basket-analysis-${start}_${end}` }}
              pdf={{ template: 'basket', data, period: { start, end }, filename: `basket-analysis-${start}_${end}` }}
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
        <table className="w-full text-sm">
          <thead>
            <tr className="text-text-secondary border-b border-border-subtle">
              <th className="py-2 text-left">Product A</th>
              <th className="py-2 text-left">Product B</th>
              <th className="py-2 text-right">Co-occurrence</th>
              <th className="py-2 text-right">Confidence</th>
              <th className="py-2 text-right">Lift</th>
            </tr>
          </thead>
          <tbody>
            {data.map((row, i) => {
              const highlight = i < 3 && row.lift > 1.0;
              return (
                <tr
                  key={`${row.product_id_a}_${row.product_id_b}`}
                  className={
                    highlight
                      ? 'border-b border-border-subtle bg-gold-soft'
                      : 'border-b border-border-subtle'
                  }
                >
                  <td className="py-2">
                    <DrilldownLink entity="product" id={row.product_id_a} label={row.product_a_name} icon={false} />
                  </td>
                  <td className="py-2">
                    <DrilldownLink entity="product" id={row.product_id_b} label={row.product_b_name} icon={false} />
                  </td>
                  <td className="py-2 text-right tabular-nums">{row.co_occurrence_count}</td>
                  <td className="py-2 text-right tabular-nums">{(row.confidence * 100).toFixed(1)}%</td>
                  <td className="py-2 text-right tabular-nums font-semibold">{row.lift.toFixed(2)}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      )}
    </ReportPage>
  );
}
