// apps/backoffice/src/pages/reports/GrossMarginPage.tsx
//
// S57 P2.6 — Gross margin per product over a date window, optionally scoped to
// one category. Table sorted by margin desc + a summary strip.
//
// Caveat surfaced in the UI: COGS is valued at the CURRENT WAC
// (products.cost_price), NOT a snapshot captured at the moment of each sale.

import { useMemo } from 'react';
import { selectClassName, cn } from '@breakery/ui';
import { toLocalDateStr } from '@breakery/domain';
import type { CsvColumn } from '@breakery/domain';
import { ReportPage } from '@/features/reports/components/ReportPage.js';
import { DateRangePicker } from '@/features/reports/components/DateRangePicker.js';
import { ExportButtons } from '@/features/reports/components/ExportButtons.js';
import { DrilldownLink } from '@/features/reports/components/DrilldownLink.js';
import {
  useGrossMargin,
  type GrossMarginProductRow,
} from '@/features/reports/hooks/useGrossMargin.js';
import { useAllCategories } from '@/features/categories/hooks/useAllCategories.js';
import { useUrlState } from '@/hooks/useUrlState.js';

const csvColumns: CsvColumn<GrossMarginProductRow>[] = [
  { header: 'Product',    accessor: (r) => r.name,                          format: 'text' },
  { header: 'Category',   accessor: (r) => r.category_name ?? '',           format: 'text' },
  { header: 'Qty',        accessor: (r) => r.qty,                           format: 'number' },
  { header: 'Revenue',    accessor: (r) => r.revenue,                       format: 'idr-round100' },
  { header: 'COGS (WAC)', accessor: (r) => r.cogs,                          format: 'idr-round100' },
  { header: 'Margin',     accessor: (r) => r.margin,                        format: 'idr-round100' },
  { header: 'Margin %',   accessor: (r) => r.margin_pct.toFixed(1),         format: 'text' },
];

function defaultStart(): string {
  return toLocalDateStr(new Date(Date.now() - 29 * 86_400_000));
}

function fmtIdr(n: number): string {
  return Math.round(n).toLocaleString('id-ID');
}

function fmtPct(n: number): string {
  return `${n.toFixed(1)}%`;
}

export default function GrossMarginPage() {
  const [start, setStart]           = useUrlState('start', defaultStart());
  const [end,   setEnd]             = useUrlState('end', toLocalDateStr(new Date()));
  const [categoryId, setCategoryId] = useUrlState('category_id', '');

  const { data: categories } = useAllCategories();
  const { data, isLoading, error } = useGrossMargin({
    start,
    end,
    categoryId: categoryId || null,
  });

  const rows = useMemo(
    () => (data ? [...data.by_product].sort((a, b) => b.margin - a.margin) : []),
    [data],
  );

  const isEmpty = !isLoading && !error && data !== undefined && rows.length === 0;

  return (
    <ReportPage
      title="Gross Margin"
      subtitle="Revenue, COGS and margin per product over the selected period."
      isEmpty={isEmpty}
      emptyState={{
        title: 'No sales',
        description: 'No sales in the selected date range and category.',
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
            <span>Category</span>
            <select
              value={categoryId}
              onChange={(e) => setCategoryId(e.target.value)}
              aria-label="Category filter"
              className={cn(selectClassName, 'h-9 w-auto')}
            >
              <option value="">All categories</option>
              {(categories ?? []).map((c) => (
                <option key={c.id} value={c.id}>{c.name}</option>
              ))}
            </select>
          </label>
          {data && rows.length > 0 && (
            <ExportButtons
              csv={{
                rows,
                columns: csvColumns,
                filename: `gross-margin-${start}_${end}`,
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

      {data && rows.length > 0 && (
        <div className="space-y-6">
          <p className="rounded-md border border-border-subtle bg-bg-overlay px-3 py-2 text-xs text-text-secondary">
            Cost basis = current weighted-average cost (<code>products.cost_price</code>),
            not a snapshot captured at the moment of each sale. Margins shift when
            supplier prices change.
          </p>

          <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
            <SummaryTile label="Revenue"  value={fmtIdr(data.summary.revenue)} />
            <SummaryTile label="COGS (WAC)" value={fmtIdr(data.summary.cogs)} />
            <SummaryTile label="Margin"   value={fmtIdr(data.summary.margin)} />
            <SummaryTile label="Margin %" value={fmtPct(data.summary.margin_pct)} />
          </div>

          <table className="w-full text-sm">
            <thead>
              <tr className="text-text-secondary border-b border-border-subtle">
                <th className="py-2 text-left">Product</th>
                <th className="py-2 text-left">Category</th>
                <th className="py-2 text-right">Qty</th>
                <th className="py-2 text-right">Revenue</th>
                <th className="py-2 text-right">COGS</th>
                <th className="py-2 text-right">Margin</th>
                <th className="py-2 text-right">Margin %</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.product_id} className="border-b border-border-subtle">
                  <td className="py-2">
                    <DrilldownLink
                      entity="product"
                      id={r.product_id}
                      label={r.name}
                      icon={false}
                    />
                  </td>
                  <td className="py-2 text-text-secondary">{r.category_name ?? '—'}</td>
                  <td className="py-2 text-right tabular-nums">{r.qty.toLocaleString('id-ID')}</td>
                  <td className="py-2 text-right tabular-nums">{fmtIdr(r.revenue)}</td>
                  <td className="py-2 text-right tabular-nums">{fmtIdr(r.cogs)}</td>
                  <td className="py-2 text-right tabular-nums">{fmtIdr(r.margin)}</td>
                  <td className="py-2 text-right tabular-nums">{fmtPct(r.margin_pct)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </ReportPage>
  );
}

function SummaryTile({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-md border border-border-subtle bg-bg-overlay p-3">
      <div className="text-xs uppercase tracking-wide text-text-secondary">{label}</div>
      <div className="mt-1 text-lg font-medium tabular-nums">{value}</div>
    </div>
  );
}
