// apps/backoffice/src/pages/reports/OffHoursSalesPage.tsx
// ADR-006 déc. 9 (business hours) — rapport « Off-Hours Sales » (signal
// fraude) : paiements encaissés hors du créneau d'ouverture du jour.
// Calcul serveur (get_off_hours_sales_v1) ; un rapport vide signifie soit
// aucune vente hors-horaire, soit des business hours non configurées.

import { toLocalDateStr } from '@breakery/domain';
import type { CsvColumn } from '@breakery/domain';
import { ReportPage } from '@/features/reports/components/ReportPage.js';
import { DateRangePicker } from '@/features/reports/components/DateRangePicker.js';
import { ExportButtons } from '@/features/reports/components/ExportButtons.js';
import { DrilldownLink } from '@/features/reports/components/DrilldownLink.js';
import { useUrlState } from '@/hooks/useUrlState.js';
import {
  useOffHoursSales,
  type OffHoursSaleRow,
} from '@/features/reports/hooks/useOffHoursSales.js';

const DAY_LABELS: Record<string, string> = {
  mon: 'Monday', tue: 'Tuesday', wed: 'Wednesday', thu: 'Thursday',
  fri: 'Friday', sat: 'Saturday', sun: 'Sunday',
};

function windowLabel(r: OffHoursSaleRow): string {
  return r.window_open !== null && r.window_close !== null
    ? `${r.window_open}–${r.window_close}`
    : 'Closed';
}

const csvColumns: CsvColumn<OffHoursSaleRow>[] = [
  { header: 'Local time',   accessor: (r) => r.local_time,              format: 'text' },
  { header: 'Day',          accessor: (r) => DAY_LABELS[r.day_key] ?? r.day_key, format: 'text' },
  { header: 'Window',       accessor: (r) => windowLabel(r),            format: 'text' },
  { header: 'Order',        accessor: (r) => r.order_number,            format: 'text' },
  { header: 'Method',       accessor: (r) => r.method,                  format: 'text' },
  { header: 'Amount (IDR)', accessor: (r) => r.amount,                  format: 'idr-round100' },
  { header: 'Cashier',      accessor: (r) => r.cashier ?? '',           format: 'text' },
];

function idr(n: number): string {
  return n.toLocaleString('id-ID', { style: 'currency', currency: 'IDR', maximumFractionDigits: 0 });
}

function defaultStart(): string {
  return toLocalDateStr(new Date(Date.now() - 29 * 86_400_000));
}

export default function OffHoursSalesPage() {
  const [start, setStart] = useUrlState('start', defaultStart());
  const [end,   setEnd]   = useUrlState('end', toLocalDateStr(new Date()));

  const { data, isLoading, error } = useOffHoursSales({ start, end });

  const rows = data?.rows ?? [];

  return (
    <ReportPage
      title="Off-Hours Sales"
      subtitle="Payments taken outside the configured business hours (fraud signal)."
      isEmpty={!isLoading && !error && data !== undefined && rows.length === 0}
      emptyState={{
        title: 'No off-hours sales',
        description:
          'No payment fell outside the opening window for this period. '
          + 'If business hours are not configured yet (Settings → Business Hours), nothing is ever flagged.',
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
              csv={{ rows, columns: csvColumns, filename: `off-hours-sales-${start}_${end}` }}
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
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-border-subtle text-text-secondary">
              <th className="py-2 text-left">Local time</th>
              <th className="py-2 text-left">Day</th>
              <th className="py-2 text-left">Window</th>
              <th className="py-2 text-left">Order</th>
              <th className="py-2 text-left">Method</th>
              <th className="py-2 text-right">Amount</th>
              <th className="py-2 text-left">Cashier</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r, i) => (
              <tr key={`${r.order_id}-${i}`} className="border-b border-border-subtle">
                <td className="py-2 tabular-nums">{r.local_time}</td>
                <td className="py-2">{DAY_LABELS[r.day_key] ?? r.day_key}</td>
                <td className="py-2 tabular-nums">{windowLabel(r)}</td>
                <td className="py-2">
                  <DrilldownLink entity="order" id={r.order_id} label={r.order_number} icon={false} />
                </td>
                <td className="py-2 capitalize">{r.method}</td>
                <td className="py-2 text-right tabular-nums">{idr(r.amount)}</td>
                <td className="py-2">{r.cashier ?? '—'}</td>
              </tr>
            ))}
          </tbody>
          <tfoot>
            <tr className="border-t border-border-subtle font-semibold">
              <td className="py-2" colSpan={4}>
                Total — {data.paymentCount} payment{data.paymentCount === 1 ? '' : 's'} on {data.orderCount} order{data.orderCount === 1 ? '' : 's'}
              </td>
              <td className="py-2" />
              <td className="py-2 text-right tabular-nums">{idr(data.totalAmount)}</td>
              <td className="py-2" />
            </tr>
          </tfoot>
        </table>
      )}
    </ReportPage>
  );
}
