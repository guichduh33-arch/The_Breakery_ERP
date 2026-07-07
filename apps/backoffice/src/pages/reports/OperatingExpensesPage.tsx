// apps/backoffice/src/pages/reports/OperatingExpensesPage.tsx
//
// Operating Expenses report — the OpEx side of the cost picture. Ventilates the
// expense ledger by category (donut + share table) and over time (trend), in
// the AMBER cost-family language. Filterable by period, category and status.

import { useMemo, useState } from 'react';
import { selectClassName, cn } from '@breakery/ui';
import {
  Area, AreaChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis,
} from 'recharts';
import { toLocalDateStr } from '@breakery/domain';
import type { CsvColumn } from '@breakery/domain';
import { PageHeader } from '@/components/PageHeader.js';
import { DateRangePicker } from '@/features/reports/components/DateRangePicker.js';
import { ExportButtons } from '@/features/reports/components/ExportButtons.js';
import { ChartCard } from '@/features/reports/components/ChartCard.js';
import { CostDonut } from '@/features/reports/components/CostDonut.js';
import {
  useExpensesByCategory,
  type ExpenseCategoryRow,
} from '@/features/reports/hooks/useExpensesByCategory.js';
import { useExpenseCategories } from '@/features/expenses/hooks/useExpensesList.js';
import {
  OPEX_BASE, familyColor,
  CHART_GRID_STROKE, CHART_AXIS_TICK, CHART_TOOLTIP_STYLE,
  formatIdrFull, formatIdrCompact,
} from '@/features/reports/utils/chartColors.js';
import { useUrlState } from '@/hooks/useUrlState.js';

const STATUS_OPTIONS: { value: string; label: string }[] = [
  { value: '',          label: 'Committed (default)' },
  { value: 'submitted', label: 'Submitted' },
  { value: 'approved',  label: 'Approved' },
  { value: 'paid',      label: 'Paid' },
  { value: 'draft',     label: 'Draft' },
  { value: 'rejected',  label: 'Rejected' },
];

const csvColumns: CsvColumn<ExpenseCategoryRow>[] = [
  { header: 'Category', accessor: (r) => r.name,            format: 'text' },
  { header: 'Total',    accessor: (r) => r.total,           format: 'idr-round100' },
  { header: 'Count',    accessor: (r) => r.count,           format: 'number' },
  { header: 'Share',    accessor: (r) => r.share_pct / 100, format: 'percent' },
];

function defaultStart(): string {
  return toLocalDateStr(new Date(Date.now() - 29 * 86_400_000));
}

export default function OperatingExpensesPage() {
  const [start, setStart]           = useUrlState('start', defaultStart());
  const [end,   setEnd]             = useUrlState('end', toLocalDateStr(new Date()));
  const [categoryId, setCategoryId] = useState<string>('');
  const [status, setStatus]         = useState<string>('');

  const { data: categories } = useExpenseCategories();
  const { data, isLoading, error } = useExpensesByCategory({
    start, end,
    categoryId: categoryId || null,
    status:     status || null,
  });

  const rows = useMemo(() => data?.by_category ?? [], [data]);
  const donut = useMemo(() => rows.map((r) => ({ name: r.name, value: r.total })), [rows]);
  const trend = data?.by_day ?? [];
  const maxShare = rows.reduce((m, r) => Math.max(m, r.share_pct), 0) || 1;

  return (
    <div className="space-y-6">
      <PageHeader
        title="Operating Expenses"
        subtitle="Expense ledger ventilated by category and over time."
        actions={
          <>
            <DateRangePicker start={start} end={end} onStartChange={setStart} onEndChange={setEnd} />
            <label className="flex items-center gap-2 text-sm text-text-secondary">
              <span>Category</span>
              <select
                className={cn(selectClassName, 'h-9 w-auto')}
                value={categoryId}
                onChange={(e) => setCategoryId(e.target.value)}
                aria-label="Filter by expense category"
              >
                <option value="">All categories</option>
                {(categories ?? []).map((c) => (
                  <option key={c.id} value={c.id}>{c.name}</option>
                ))}
              </select>
            </label>
            <label className="flex items-center gap-2 text-sm text-text-secondary">
              <span>Status</span>
              <select
                className={cn(selectClassName, 'h-9 w-auto')}
                value={status}
                onChange={(e) => setStatus(e.target.value)}
                aria-label="Filter by expense status"
              >
                {STATUS_OPTIONS.map((o) => (
                  <option key={o.value} value={o.value}>{o.label}</option>
                ))}
              </select>
            </label>
            {data && (
              <ExportButtons
                csv={{ rows, columns: csvColumns, filename: `operating-expenses-${start}_${end}` }}
              />
            )}
          </>
        }
      />

      {error && (
        <p className="text-sm text-danger" role="alert">
          {error.message ?? 'Failed to load expenses report.'}
        </p>
      )}

      {/* KPI strip */}
      <div className="grid grid-cols-3 gap-4">
        <div className="relative overflow-hidden rounded-lg border border-border-subtle bg-surface-2 p-4">
          <span className="absolute inset-y-0 left-0 w-1" style={{ backgroundColor: OPEX_BASE }} aria-hidden />
          <p className="pl-2 text-xs uppercase tracking-wide text-text-secondary">Total OpEx</p>
          <p className="mt-1 pl-2 font-mono text-2xl font-semibold tabular-nums text-text-primary">
            {formatIdrCompact(data?.summary.total ?? 0)}
          </p>
        </div>
        <div className="rounded-lg border border-border-subtle bg-surface-2 p-4">
          <p className="text-xs uppercase tracking-wide text-text-secondary">Entries</p>
          <p className="mt-1 font-mono text-2xl font-semibold tabular-nums text-text-primary">
            {data?.summary.count ?? 0}
          </p>
        </div>
        <div className="rounded-lg border border-border-subtle bg-surface-2 p-4">
          <p className="text-xs uppercase tracking-wide text-text-secondary">Avg / entry</p>
          <p className="mt-1 font-mono text-2xl font-semibold tabular-nums text-text-primary">
            {formatIdrCompact(data?.summary.avg ?? 0)}
          </p>
        </div>
      </div>

      {isLoading && <p className="text-sm text-text-secondary">Loading…</p>}

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <ChartCard title="By category" subtitle="Share of operating expense" accent={OPEX_BASE}>
          <CostDonut data={donut} family="opex" centerLabel="OpEx" maxLegend={8} />
        </ChartCard>

        <ChartCard title="Trend" subtitle="Daily operating expense" accent={OPEX_BASE}>
          <div className="h-64 w-full">
            <ResponsiveContainer width="100%" height="100%">
              <AreaChart data={trend} margin={{ top: 8, right: 12, bottom: 0, left: 8 }}>
                <CartesianGrid stroke={CHART_GRID_STROKE} strokeDasharray="3 3" vertical={false} />
                <XAxis
                  dataKey="date"
                  tickFormatter={(d: string) => d.slice(5)}
                  tick={{ fontSize: 11, fill: CHART_AXIS_TICK }}
                  tickLine={false}
                />
                <YAxis
                  tickFormatter={formatIdrCompact}
                  tick={{ fontSize: 11, fill: CHART_AXIS_TICK }}
                  tickLine={false}
                  width={72}
                />
                <Tooltip
                  formatter={(v: number) => [formatIdrFull(v), 'OpEx']}
                  contentStyle={CHART_TOOLTIP_STYLE}
                />
                <Area type="monotone" dataKey="total" name="OpEx"
                  stroke={OPEX_BASE} fill={OPEX_BASE} fillOpacity={0.8} />
              </AreaChart>
            </ResponsiveContainer>
          </div>
        </ChartCard>
      </div>

      {/* Category table with inline share bars */}
      <ChartCard title="Category breakdown" accent={OPEX_BASE}>
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-border-subtle text-text-secondary">
              <th className="py-2 text-left">Category</th>
              <th className="py-2 text-right">Total</th>
              <th className="py-2 text-right">Count</th>
              <th className="py-2 text-right">Share</th>
              <th className="py-2 pl-4 text-left">Distribution</th>
            </tr>
          </thead>
          <tbody>
            {rows.length === 0 && (
              <tr>
                <td className="py-3 text-text-secondary" colSpan={5}>
                  No expenses for the selected filters.
                </td>
              </tr>
            )}
            {rows.map((r, i) => (
              <tr key={r.category_id} className="border-b border-border-subtle">
                <td className="py-2 font-medium text-text-primary">{r.name}</td>
                <td className="py-2 text-right font-mono tabular-nums">{formatIdrFull(r.total)}</td>
                <td className="py-2 text-right tabular-nums text-text-secondary">{r.count}</td>
                <td className="py-2 text-right tabular-nums">{r.share_pct.toFixed(1)}%</td>
                <td className="py-2 pl-4">
                  <div className="h-2 w-full overflow-hidden rounded-sm bg-surface-4">
                    <div
                      className="h-full rounded-sm"
                      style={{
                        width: `${(r.share_pct / maxShare) * 100}%`,
                        backgroundColor: familyColor('opex', i),
                      }}
                    />
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </ChartCard>
    </div>
  );
}
