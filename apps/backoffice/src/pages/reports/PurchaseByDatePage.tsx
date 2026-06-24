// apps/backoffice/src/pages/reports/PurchaseByDatePage.tsx
// S40 Wave B2 — Purchase orders aggregated by date: KPI cards + by_day table.

import { useState } from 'react';
import {
  Area,
  AreaChart,
  CartesianGrid,
  Legend,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import { toLocalDateStr } from '@breakery/domain';
import type { CsvColumn } from '@breakery/domain';
import { ReportPage } from '@/features/reports/components/ReportPage.js';
import { DateRangePicker } from '@/features/reports/components/DateRangePicker.js';
import { ExportButtons } from '@/features/reports/components/ExportButtons.js';
import { ChartCard } from '@/features/reports/components/ChartCard.js';
import {
  COGS_BASE,
  familyColor,
  CHART_GRID_STROKE,
  CHART_AXIS_TICK,
  CHART_TOOLTIP_STYLE,
  formatIdrFull,
  formatIdrCompact,
} from '@/features/reports/utils/chartColors.js';
import {
  usePurchaseByDate,
  type PurchaseByDayRow,
} from '@/features/reports/hooks/usePurchaseByDate.js';

const csvColumns: CsvColumn<PurchaseByDayRow>[] = [
  { header: 'Date',           accessor: (r) => r.date,           format: 'text' },
  { header: 'POs',            accessor: (r) => r.po_count,       format: 'number' },
  { header: 'Total (IDR)',    accessor: (r) => r.total,          format: 'idr-round100' },
  { header: 'Received (IDR)', accessor: (r) => r.received_total, format: 'idr-round100' },
  { header: 'Pending (IDR)',  accessor: (r) => r.pending_total,  format: 'idr-round100' },
];

const IDR = (v: number) =>
  v.toLocaleString('id-ID', { style: 'currency', currency: 'IDR', maximumFractionDigits: 0 });

function defaultStart(): string {
  return toLocalDateStr(new Date(Date.now() - 29 * 86_400_000));
}

export default function PurchaseByDatePage() {
  const [start, setStart] = useState<string>(defaultStart);
  const [end,   setEnd]   = useState<string>(() => toLocalDateStr(new Date()));

  const { data, isLoading, error } = usePurchaseByDate({ start, end });

  const rows = data?.by_day ?? [];

  return (
    <ReportPage
      title="Purchase by Date"
      subtitle="Purchase order volume and value aggregated by order date."
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
              csv={{ rows, columns: csvColumns, filename: `purchase-by-date-${start}_${end}` }}
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
          {/* KPI summary cards */}
          <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
            {[
              { label: 'PO count',  value: String(data.summary.po_count) },
              { label: 'Total',     value: IDR(data.summary.total) },
              { label: 'Received',  value: String(data.summary.received_count) },
              { label: 'Pending',   value: String(data.summary.pending_count) },
            ].map(({ label, value }) => (
              <div key={label} className="rounded-lg border border-border-subtle bg-surface-raised p-4">
                <p className="text-xs text-text-secondary uppercase tracking-wide">{label}</p>
                <p className="mt-1 text-lg font-semibold tabular-nums">{value}</p>
              </div>
            ))}
          </div>

          {/* Stacked received vs pending value over time */}
          <ChartCard
            title="Purchase value over time"
            subtitle="Received vs pending PO value by day"
            accent={COGS_BASE}
          >
            <div className="h-72 w-full">
              <ResponsiveContainer width="100%" height="100%">
                <AreaChart data={rows} margin={{ top: 10, right: 16, bottom: 0, left: 8 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke={CHART_GRID_STROKE} />
                  <XAxis
                    dataKey="date"
                    tick={{ fill: CHART_AXIS_TICK, fontSize: 12 }}
                  />
                  <YAxis
                    tickFormatter={formatIdrCompact}
                    tick={{ fill: CHART_AXIS_TICK, fontSize: 12 }}
                    width={72}
                  />
                  <Tooltip
                    formatter={(v: number, n: string) => [formatIdrFull(v), n]}
                    contentStyle={CHART_TOOLTIP_STYLE}
                  />
                  <Legend />
                  <Area
                    type="monotone"
                    dataKey="received_total"
                    name="Received"
                    stackId="v"
                    stroke={COGS_BASE}
                    fill={COGS_BASE}
                    fillOpacity={0.85}
                  />
                  <Area
                    type="monotone"
                    dataKey="pending_total"
                    name="Pending"
                    stackId="v"
                    stroke={familyColor('cogs', 2)}
                    fill={familyColor('cogs', 2)}
                    fillOpacity={0.7}
                  />
                </AreaChart>
              </ResponsiveContainer>
            </div>
          </ChartCard>

          {/* By-day table */}
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-border-subtle text-text-secondary">
                <th className="py-2 text-left">Date</th>
                <th className="py-2 text-right">POs</th>
                <th className="py-2 text-right">Total</th>
                <th className="py-2 text-right">Received total</th>
                <th className="py-2 text-right">Pending total</th>
              </tr>
            </thead>
            <tbody>
              {rows.length === 0 && (
                <tr>
                  <td className="py-3 text-text-secondary" colSpan={5}>
                    No purchase orders for this period.
                  </td>
                </tr>
              )}
              {rows.map((r) => (
                <tr key={r.date} className="border-b border-border-subtle">
                  <td className="py-2 text-text-secondary">{r.date}</td>
                  <td className="py-2 text-right tabular-nums">{r.po_count}</td>
                  <td className="py-2 text-right tabular-nums">{IDR(r.total)}</td>
                  <td className="py-2 text-right tabular-nums">{IDR(r.received_total)}</td>
                  <td className="py-2 text-right tabular-nums">{IDR(r.pending_total)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </ReportPage>
  );
}
