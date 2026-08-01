// apps/backoffice/src/pages/reports/PaymentByMethodPage.tsx
// S30 Wave 4.2 — Payments by method report with date range filter + export.
//
// S32 / Wave 3.I : method cells now drill into /backoffice/orders filtered by
// payment_method + start/end (DrilldownLink entity="order_list").

import { useMemo } from 'react';
import {
  Area, AreaChart, CartesianGrid, Legend, ResponsiveContainer, Tooltip, XAxis, YAxis,
} from 'recharts';
import { toLocalDateStr } from '@breakery/domain';
import type { CsvColumn } from '@breakery/domain';
import { ReportPage } from '@/features/reports/components/ReportPage.js';
import { ChartCard } from '@/features/reports/components/ChartCard.js';
import { DateRangePicker } from '@/features/reports/components/DateRangePicker.js';
import { ExportButtons } from '@/features/reports/components/ExportButtons.js';
import { DrilldownLink } from '@/features/reports/components/DrilldownLink.js';
import { useUrlState } from '@/hooks/useUrlState.js';
import {
  categoricalColor,
  CHART_GRID_STROKE, CHART_AXIS_TICK, CHART_TOOLTIP_STYLE,
  formatIdrFull, formatIdrCompact,
} from '@/features/reports/utils/chartColors.js';
import {
  usePaymentsByMethod,
  PAYMENT_METHOD_KEYS,
  type PaymentByMethodLine,
} from '@/features/reports/hooks/usePaymentsByMethod.js';

// Lot C (ADR-006 déc. 9) — frais informatifs par méthode : fee_pct vient de
// business_config.payment_method_fees, fee_est/net_est sont calculés serveur.
const csvColumns: CsvColumn<PaymentByMethodLine>[] = [
  { header: 'Method',         accessor: (r) => r.method,           format: 'text' },
  { header: 'Amount (IDR)',   accessor: (r) => r.amount,           format: 'idr-round100' },
  { header: 'Count',          accessor: (r) => r.count,            format: 'number' },
  { header: 'Share (%)',      accessor: (r) => r.share_pct / 100,  format: 'percent' },
  { header: 'Fee (%)',        accessor: (r) => r.fee_pct / 100,    format: 'percent' },
  { header: 'Fee est. (IDR)', accessor: (r) => r.fee_est,          format: 'idr-round100' },
  { header: 'Net est. (IDR)', accessor: (r) => r.net_est,          format: 'idr-round100' },
];

function idr(n: number): string {
  return n.toLocaleString('id-ID', { style: 'currency', currency: 'IDR', maximumFractionDigits: 0 });
}

function defaultStart(): string {
  return toLocalDateStr(new Date(Date.now() - 29 * 86_400_000));
}

export default function PaymentByMethodPage() {
  const [start, setStart] = useUrlState('start', defaultStart());
  const [end,   setEnd]   = useUrlState('end', toLocalDateStr(new Date()));

  const { data, isLoading, error } = usePaymentsByMethod({ start, end });

  const lines = data?.lines ?? [];
  const byDay = useMemo(() => data?.byDay ?? [], [data]);

  // N'empiler que les méthodes réellement utilisées sur la période : le pivot
  // serveur renvoie les 10 colonnes systématiquement, dont 7 à zéro en général.
  const activeMethods = useMemo(
    () => PAYMENT_METHOD_KEYS.filter((k) => byDay.some((d) => d[k] > 0)),
    [byDay],
  );

  return (
    <ReportPage
      title="Payment by Method"
      subtitle="Total collected per payment method across a date range."
      isEmpty={!isLoading && !error && data !== undefined && lines.length === 0}
      emptyState={{
        title: 'No payments',
        description: 'No payment data for this period.',
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
              csv={{ rows: lines, columns: csvColumns, filename: `payment-by-method-${start}_${end}` }}
              pdf={{
                template: 'payment_by_method',
                data,
                period: { start, end },
                filename: `payment-by-method-${start}_${end}`,
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
      {data && activeMethods.length > 0 && (
        <ChartCard
          title="Daily trend"
          subtitle="Collected per day, stacked by payment method"
          className="mb-6"
        >
          <div className="h-64 w-full">
            <ResponsiveContainer width="100%" height="100%">
              <AreaChart data={byDay} margin={{ top: 8, right: 12, bottom: 0, left: 8 }}>
                <CartesianGrid stroke={CHART_GRID_STROKE} strokeDasharray="3 3" vertical={false} />
                <XAxis
                  dataKey="day"
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
                  formatter={(v: number, n: string) => [formatIdrFull(v), n]}
                  contentStyle={CHART_TOOLTIP_STYLE}
                />
                <Legend wrapperStyle={{ fontSize: 12 }} />
                {activeMethods.map((m, i) => (
                  <Area
                    key={m}
                    type="monotone"
                    dataKey={m}
                    name={m.replace('_', ' ')}
                    // stackId partagé : les méthodes se somment au total du jour,
                    // les empiler est la lecture juste (pas des séries rivales).
                    stackId="pm"
                    stroke={categoricalColor(i)}
                    fill={categoricalColor(i)}
                    fillOpacity={0.85}
                  />
                ))}
              </AreaChart>
            </ResponsiveContainer>
          </div>
        </ChartCard>
      )}
      {data && (
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-border-subtle text-text-secondary">
              <th className="py-2 text-left">Method</th>
              <th className="py-2 text-right">Amount (IDR)</th>
              <th className="py-2 text-right">Count</th>
              <th className="py-2 text-right">Share</th>
              <th className="py-2 text-right">Fee</th>
              <th className="py-2 text-right">Fee est.</th>
              <th className="py-2 text-right">Net est.</th>
            </tr>
          </thead>
          <tbody>
            {lines.map((r) => (
              <tr key={r.method} className="border-b border-border-subtle">
                <td className="py-2 font-medium capitalize">
                  <DrilldownLink
                    entity="order_list"
                    id=""
                    label={r.method}
                    filter={{ payment_method: r.method, start, end }}
                    icon={false}
                  />
                </td>
                <td className="py-2 text-right tabular-nums">{idr(r.amount)}</td>
                <td className="py-2 text-right tabular-nums">{r.count}</td>
                <td className="py-2 text-right tabular-nums">{r.share_pct.toFixed(1)}%</td>
                <td className="py-2 text-right tabular-nums">{r.fee_pct > 0 ? `${r.fee_pct}%` : '—'}</td>
                <td className="py-2 text-right tabular-nums">{idr(r.fee_est)}</td>
                <td className="py-2 text-right tabular-nums">{idr(r.net_est)}</td>
              </tr>
            ))}
          </tbody>
          {lines.length > 0 && (
            <tfoot>
              <tr className="border-t border-border-subtle font-semibold">
                <td className="py-2">Total</td>
                <td className="py-2 text-right tabular-nums">{idr(data.total ?? 0)}</td>
                <td className="py-2 text-right tabular-nums">
                  {lines.reduce((sum, r) => sum + r.count, 0)}
                </td>
                <td className="py-2 text-right tabular-nums">100%</td>
                <td className="py-2" />
                <td className="py-2 text-right tabular-nums">{idr(data.totalFees ?? 0)}</td>
                <td className="py-2 text-right tabular-nums">{idr(data.totalNet ?? 0)}</td>
              </tr>
            </tfoot>
          )}
        </table>
      )}
    </ReportPage>
  );
}
