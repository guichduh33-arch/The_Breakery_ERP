// apps/backoffice/src/pages/reports/PurchaseBySupplierPage.tsx
// S40 Wave B2 — Purchase orders aggregated by supplier: table with share % and avg lead days.
// Terminal page — no supplier drill-down (documented decision: Wave C owns routing).

import { useState } from 'react';
import { toLocalDateStr } from '@breakery/domain';
import type { CsvColumn } from '@breakery/domain';
import { ReportPage } from '@/features/reports/components/ReportPage.js';
import { DateRangePicker } from '@/features/reports/components/DateRangePicker.js';
import { ExportButtons } from '@/features/reports/components/ExportButtons.js';
import { ChartCard } from '@/features/reports/components/ChartCard.js';
import { CostDonut } from '@/features/reports/components/CostDonut.js';
import { COGS_BASE } from '@/features/reports/utils/chartColors.js';
import {
  usePurchaseBySupplier,
  type PurchaseBySupplierRow,
} from '@/features/reports/hooks/usePurchaseBySupplier.js';

const csvColumns: CsvColumn<PurchaseBySupplierRow>[] = [
  { header: 'Supplier',       accessor: (r) => r.supplier_name,          format: 'text' },
  { header: 'POs',            accessor: (r) => r.po_count,               format: 'number' },
  { header: 'Total (IDR)',    accessor: (r) => r.total,                  format: 'idr-round100' },
  { header: 'Received',       accessor: (r) => r.received_count,         format: 'number' },
  { header: 'Cancelled',      accessor: (r) => r.cancelled_count,        format: 'number' },
  { header: 'Avg lead days',  accessor: (r) => r.avg_lead_days,          format: 'number' },
  { header: 'Share (%)',      accessor: (r) => r.share_pct / 100,        format: 'percent' },
];

const IDR = (v: number) =>
  v.toLocaleString('id-ID', { style: 'currency', currency: 'IDR', maximumFractionDigits: 0 });

function defaultStart(): string {
  return toLocalDateStr(new Date(Date.now() - 29 * 86_400_000));
}

export default function PurchaseBySupplierPage() {
  const [start, setStart] = useState<string>(defaultStart);
  const [end,   setEnd]   = useState<string>(() => toLocalDateStr(new Date()));

  const { data, isLoading, error } = usePurchaseBySupplier({ start, end });

  const rows = data?.by_supplier ?? [];

  return (
    <ReportPage
      title="Purchase by Supplier"
      subtitle="Purchase volume, value, and lead time broken down by supplier."
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
              csv={{ rows, columns: csvColumns, filename: `purchase-by-supplier-${start}_${end}` }}
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
          {/* Spend distribution by supplier */}
          <ChartCard title="Spend by supplier" accent={COGS_BASE}>
            <CostDonut
              family="cogs"
              centerLabel="Total"
              data={rows.map((r) => ({ name: r.supplier_name, value: r.total }))}
            />
          </ChartCard>

          <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-border-subtle text-text-secondary">
              <th className="py-2 text-left">Supplier</th>
              <th className="py-2 text-right">POs</th>
              <th className="py-2 text-right">Total</th>
              <th className="py-2 text-right">Received</th>
              <th className="py-2 text-right">Cancelled</th>
              <th className="py-2 text-right">Avg lead days</th>
              <th className="py-2 text-right">Share</th>
            </tr>
          </thead>
          <tbody>
            {rows.length === 0 && (
              <tr>
                <td className="py-3 text-text-secondary" colSpan={7}>
                  No purchase orders for this period.
                </td>
              </tr>
            )}
            {rows.map((r) => (
              <tr key={r.supplier_id} className="border-b border-border-subtle">
                <td className="py-2 font-medium">{r.supplier_name}</td>
                <td className="py-2 text-right tabular-nums">{r.po_count}</td>
                <td className="py-2 text-right tabular-nums">{IDR(r.total)}</td>
                <td className="py-2 text-right tabular-nums">{r.received_count}</td>
                <td className="py-2 text-right tabular-nums">{r.cancelled_count}</td>
                <td className="py-2 text-right tabular-nums text-text-secondary">
                  {r.avg_lead_days !== null ? r.avg_lead_days : '—'}
                </td>
                <td className="py-2 text-right tabular-nums">
                  {r.share_pct.toFixed(2)}%
                </td>
              </tr>
            ))}
          </tbody>
          </table>
        </div>
      )}
    </ReportPage>
  );
}
