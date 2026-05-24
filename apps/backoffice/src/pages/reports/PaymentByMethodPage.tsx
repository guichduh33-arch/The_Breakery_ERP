// apps/backoffice/src/pages/reports/PaymentByMethodPage.tsx
// S30 Wave 4.2 — Payments by method report with date range filter + export.

import { useState } from 'react';
import { toLocalDateStr } from '@breakery/domain';
import type { CsvColumn } from '@breakery/domain';
import { ReportPage } from '@/features/reports/components/ReportPage.js';
import { DateRangePicker } from '@/features/reports/components/DateRangePicker.js';
import { ExportButtons } from '@/features/reports/components/ExportButtons.js';
import {
  usePaymentsByMethod,
  type PaymentByMethodLine,
} from '@/features/reports/hooks/usePaymentsByMethod.js';

const csvColumns: CsvColumn<PaymentByMethodLine>[] = [
  { header: 'Method',       accessor: (r) => r.method,           format: 'text' },
  { header: 'Amount (IDR)', accessor: (r) => r.amount,           format: 'idr-round100' },
  { header: 'Count',        accessor: (r) => r.count,            format: 'number' },
  { header: 'Share (%)',    accessor: (r) => r.share_pct / 100,  format: 'percent' },
];

function defaultStart(): string {
  return toLocalDateStr(new Date(Date.now() - 29 * 86_400_000));
}

export default function PaymentByMethodPage() {
  const [start, setStart] = useState<string>(defaultStart);
  const [end,   setEnd]   = useState<string>(() => toLocalDateStr(new Date()));

  const { data, isLoading, error } = usePaymentsByMethod({ start, end });

  const lines = data?.lines ?? [];

  return (
    <ReportPage
      title="Payment by Method"
      subtitle="Total collected per payment method across a date range."
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
        <p className="text-sm text-red-500" role="alert">
          {error.message ?? 'Failed to load report.'}
        </p>
      )}
      {data && (
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-border-subtle text-text-secondary">
              <th className="py-2 text-left">Method</th>
              <th className="py-2 text-right">Amount (IDR)</th>
              <th className="py-2 text-right">Count</th>
              <th className="py-2 text-right">Share</th>
            </tr>
          </thead>
          <tbody>
            {lines.length === 0 && (
              <tr>
                <td className="py-3 text-text-secondary" colSpan={4}>
                  No payment data for this period.
                </td>
              </tr>
            )}
            {lines.map((r) => (
              <tr key={r.method} className="border-b border-border-subtle">
                <td className="py-2 font-medium capitalize">{r.method}</td>
                <td className="py-2 text-right tabular-nums">
                  {r.amount.toLocaleString('id-ID', { style: 'currency', currency: 'IDR', maximumFractionDigits: 0 })}
                </td>
                <td className="py-2 text-right tabular-nums">{r.count}</td>
                <td className="py-2 text-right tabular-nums">{r.share_pct.toFixed(1)}%</td>
              </tr>
            ))}
          </tbody>
          {lines.length > 0 && (
            <tfoot>
              <tr className="border-t border-border-subtle font-semibold">
                <td className="py-2">Total</td>
                <td className="py-2 text-right tabular-nums">
                  {(data.total ?? 0).toLocaleString('id-ID', { style: 'currency', currency: 'IDR', maximumFractionDigits: 0 })}
                </td>
                <td className="py-2 text-right tabular-nums">
                  {lines.reduce((sum, r) => sum + r.count, 0)}
                </td>
                <td className="py-2 text-right tabular-nums">100%</td>
              </tr>
            </tfoot>
          )}
        </table>
      )}
    </ReportPage>
  );
}
