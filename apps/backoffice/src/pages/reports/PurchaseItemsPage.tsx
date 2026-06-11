// apps/backoffice/src/pages/reports/PurchaseItemsPage.tsx
// S40 Wave B2 — Purchase order line items report with supplier filter + CSV export.

import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { toLocalDateStr } from '@breakery/domain';
import type { CsvColumn } from '@breakery/domain';
import { ReportPage } from '@/features/reports/components/ReportPage.js';
import { DateRangePicker } from '@/features/reports/components/DateRangePicker.js';
import { ExportButtons } from '@/features/reports/components/ExportButtons.js';
import { supabase } from '@/lib/supabase.js';
import {
  usePurchaseItems,
  type PurchaseItemLine,
} from '@/features/reports/hooks/usePurchaseItems.js';

interface SupplierOption {
  id:   string;
  name: string;
}

const csvColumns: CsvColumn<PurchaseItemLine>[] = [
  { header: 'PO#',           accessor: (r) => r.po_number,         format: 'text' },
  { header: 'Date',          accessor: (r) => r.order_date,        format: 'text' },
  { header: 'Supplier',      accessor: (r) => r.supplier_name,     format: 'text' },
  { header: 'Product',       accessor: (r) => r.product_name,      format: 'text' },
  { header: 'SKU',           accessor: (r) => r.sku,               format: 'text' },
  { header: 'Qty',           accessor: (r) => r.quantity,          format: 'number' },
  { header: 'Received',      accessor: (r) => r.received_quantity, format: 'number' },
  { header: 'Unit cost (IDR)', accessor: (r) => r.unit_cost,       format: 'idr-round100' },
  { header: 'Subtotal (IDR)', accessor: (r) => r.subtotal,         format: 'idr-round100' },
  { header: 'Status',        accessor: (r) => r.status,            format: 'text' },
];

const IDR = (v: number) =>
  v.toLocaleString('id-ID', { style: 'currency', currency: 'IDR', maximumFractionDigits: 0 });

function defaultStart(): string {
  return toLocalDateStr(new Date(Date.now() - 29 * 86_400_000));
}

export default function PurchaseItemsPage() {
  const [start,      setStart]      = useState<string>(defaultStart);
  const [end,        setEnd]        = useState<string>(() => toLocalDateStr(new Date()));
  const [supplierId, setSupplierId] = useState<string>('');

  // Supplier options for the native <select>
  const { data: supplierOptions } = useQuery<SupplierOption[]>({
    queryKey: ['suppliers-options'],
    queryFn:  async () => {
      const { data, error } = await supabase
        .from('suppliers')
        .select('id, name')
        .eq('is_active', true)
        .order('name');
      if (error) throw error;
      return (data ?? []) as SupplierOption[];
    },
    staleTime: 5 * 60 * 1000,
  });

  const { data, isLoading, error } = usePurchaseItems({
    start,
    end,
    supplierId: supplierId || null,
  });

  const lines = data?.lines ?? [];

  return (
    <ReportPage
      title="Purchase Items"
      subtitle="Line items across received purchase orders, with optional supplier filter."
      filters={
        <div className="flex items-center gap-3 flex-wrap">
          <DateRangePicker
            start={start}
            end={end}
            onStartChange={setStart}
            onEndChange={setEnd}
          />
          {/* Native <select> — @breakery/ui does not export a Select component */}
          <label className="flex items-center gap-2 text-sm text-text-secondary">
            <span>Supplier</span>
            <select
              className="h-9 rounded-md border border-border-subtle bg-surface px-2 text-sm text-text-primary"
              value={supplierId}
              onChange={(e) => setSupplierId(e.target.value)}
              aria-label="Filter by supplier"
            >
              <option value="">All suppliers</option>
              {(supplierOptions ?? []).map((s) => (
                <option key={s.id} value={s.id}>{s.name}</option>
              ))}
            </select>
          </label>
          {data && (
            <ExportButtons
              csv={{ rows: lines, columns: csvColumns, filename: `purchase-items-${start}_${end}` }}
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
      {data?.truncated && (
        <p className="mb-3 rounded-md border border-amber-300 bg-amber-50 px-3 py-2 text-sm text-amber-800">
          First 1000 rows shown — narrow the date range to see all results.
        </p>
      )}
      {data && (
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-border-subtle text-text-secondary">
              <th className="py-2 text-left">PO#</th>
              <th className="py-2 text-left">Date</th>
              <th className="py-2 text-left">Supplier</th>
              <th className="py-2 text-left">Product</th>
              <th className="py-2 text-left">SKU</th>
              <th className="py-2 text-right">Qty</th>
              <th className="py-2 text-right">Received</th>
              <th className="py-2 text-right">Unit cost</th>
              <th className="py-2 text-right">Subtotal</th>
              <th className="py-2 text-left">Status</th>
            </tr>
          </thead>
          <tbody>
            {lines.length === 0 && (
              <tr>
                <td className="py-3 text-text-secondary" colSpan={10}>
                  No purchase lines for this period.
                </td>
              </tr>
            )}
            {lines.map((r, idx) => (
              <tr key={`${r.po_id}-${r.product_id}-${idx}`} className="border-b border-border-subtle">
                <td className="py-2 font-medium">{r.po_number}</td>
                <td className="py-2 text-text-secondary">{String(r.order_date).slice(0, 10)}</td>
                <td className="py-2 text-text-secondary">{r.supplier_name}</td>
                <td className="py-2">{r.product_name}</td>
                <td className="py-2 text-text-secondary font-mono text-xs">{r.sku}</td>
                <td className="py-2 text-right tabular-nums">{r.quantity}</td>
                <td className="py-2 text-right tabular-nums">{r.received_quantity}</td>
                <td className="py-2 text-right tabular-nums">{IDR(r.unit_cost)}</td>
                <td className="py-2 text-right tabular-nums">{IDR(r.subtotal)}</td>
                <td className="py-2 capitalize text-text-secondary">{r.status}</td>
              </tr>
            ))}
          </tbody>
          {lines.length > 0 && (
            <tfoot>
              <tr className="border-t border-border-subtle font-semibold">
                <td className="py-2" colSpan={8}>Total ({data.summary.line_count} lines)</td>
                <td className="py-2 text-right tabular-nums">
                  {IDR(data.summary.total_value)}
                </td>
                <td />
              </tr>
            </tfoot>
          )}
        </table>
      )}
    </ReportPage>
  );
}
