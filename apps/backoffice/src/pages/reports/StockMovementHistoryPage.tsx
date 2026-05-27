// apps/backoffice/src/pages/reports/StockMovementHistoryPage.tsx
// S30 Wave 4.2 — Stock movement ledger with infinite scroll (cursor-based).
// PDF export is intentionally omitted: pagination makes a single-render PDF impractical.
// DEV-S30-4.X-01: only CSV export is provided.

import { useState } from 'react';
import { toLocalDateStr } from '@breakery/domain';
import type { CsvColumn } from '@breakery/domain';
import { ReportPage } from '@/features/reports/components/ReportPage.js';
import { DateRangePicker } from '@/features/reports/components/DateRangePicker.js';
import { ExportButtons } from '@/features/reports/components/ExportButtons.js';
import { DrilldownLink } from '@/features/reports/components/DrilldownLink.js';
import {
  useStockMovementsReport,
  type StockMovementLine,
} from '@/features/reports/hooks/useStockMovementsReport.js';

const csvColumns: CsvColumn<StockMovementLine>[] = [
  { header: 'Date',          accessor: (r) => r.created_at,      format: 'datetime' },
  { header: 'Type',          accessor: (r) => r.movement_type,   format: 'text' },
  { header: 'Product',       accessor: (r) => r.product_name,    format: 'text' },
  { header: 'Qty',           accessor: (r) => r.quantity,        format: 'number' },
  { header: 'Value (IDR)',   accessor: (r) => r.value,           format: 'idr-round100' },
  { header: 'Ref type',      accessor: (r) => r.reference_type ?? '', format: 'text' },
  { header: 'Ref ID',        accessor: (r) => r.reference_id    ?? '', format: 'text' },
  { header: 'Created by',    accessor: (r) => r.created_by_name ?? '', format: 'text' },
];

function defaultStart(): string {
  return toLocalDateStr(new Date(Date.now() - 29 * 86_400_000));
}

const MOVEMENT_TYPES = [
  '', 'sale', 'sale_void', 'adjustment_positive', 'adjustment_negative',
  'incoming', 'purchase', 'waste', 'production_in', 'production_out',
  'transfer_in', 'transfer_out', 'opname_adjustment',
];

export default function StockMovementHistoryPage() {
  const [start,         setStart]         = useState<string>(defaultStart);
  const [end,           setEnd]           = useState<string>(() => toLocalDateStr(new Date()));
  const [typeFilter, setTypeFilter] = useState<string>('');

  const movementType: string | undefined = typeFilter || undefined;

  const query = useStockMovementsReport({
    start,
    end,
    movement_type: movementType,
  });

  // Flatten all pages for CSV export
  const allLines: StockMovementLine[] = query.data?.pages.flatMap((p) => p.lines) ?? [];

  return (
    <ReportPage
      title="Stock Movement History"
      subtitle="Paginated ledger of all stock movements. PDF not available — use CSV export."
      filters={
        <div className="flex flex-wrap items-center gap-3">
          <DateRangePicker
            start={start}
            end={end}
            onStartChange={setStart}
            onEndChange={setEnd}
          />
          {/* Movement type filter */}
          <select
            className="h-9 rounded-md border border-border-subtle bg-surface px-2 text-sm text-text-primary"
            value={typeFilter}
            onChange={(e) => setTypeFilter(e.target.value)}
            aria-label="Filter by movement type"
          >
            <option value="">All types</option>
            {MOVEMENT_TYPES.slice(1).map((t) => (
              <option key={t} value={t}>{t}</option>
            ))}
          </select>
          {allLines.length > 0 && (
            <ExportButtons
              csv={{ rows: allLines, columns: csvColumns, filename: `stock-movements-${start}_${end}` }}
            />
          )}
        </div>
      }
    >
      {query.isLoading && <p className="text-sm text-text-secondary">Loading…</p>}
      {query.error && (
        <p className="text-sm text-red-500" role="alert">
          {query.error.message ?? 'Failed to load report.'}
        </p>
      )}
      {query.data && (
        <>
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-border-subtle text-text-secondary">
                <th className="py-2 text-left">Date</th>
                <th className="py-2 text-left">Product</th>
                <th className="py-2 text-left">Type</th>
                <th className="py-2 text-right">Qty</th>
                <th className="py-2 text-right">Value (IDR)</th>
                <th className="py-2 text-left">Ref</th>
              </tr>
            </thead>
            <tbody>
              {allLines.length === 0 && (
                <tr>
                  <td className="py-3 text-text-secondary" colSpan={6}>
                    No stock movements for this period.
                  </td>
                </tr>
              )}
              {allLines.map((l) => (
                <tr key={l.id} className="border-b border-border-subtle">
                  <td className="py-2 text-text-secondary">
                    {l.created_at.slice(0, 16).replace('T', ' ')}
                  </td>
                  <td className="py-2 font-medium">
                    <DrilldownLink
                      entity="product"
                      id={l.product_id}
                      label={l.product_name}
                      icon={false}
                    />
                  </td>
                  <td className="py-2 text-text-secondary">{l.movement_type}</td>
                  <td className="py-2 text-right tabular-nums">{l.quantity}</td>
                  <td className="py-2 text-right tabular-nums">
                    {l.value.toLocaleString('id-ID', { style: 'currency', currency: 'IDR', maximumFractionDigits: 0 })}
                  </td>
                  <td className="py-2 text-xs text-text-secondary">
                    {l.reference_type === 'purchase' && l.reference_id ? (
                      <DrilldownLink entity="purchase_order" id={l.reference_id} label={`PO ${l.reference_id.slice(0, 8)}`} icon={false} />
                    ) : l.reference_type === 'expense' && l.reference_id ? (
                      <DrilldownLink entity="expense" id={l.reference_id} label={`Exp ${l.reference_id.slice(0, 8)}`} icon={false} />
                    ) : (
                      l.reference_type ?? '—'
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>

          {query.hasNextPage && (
            <div className="mt-4 flex justify-center">
              <button
                type="button"
                className="rounded-md border border-border-subtle px-4 py-2 text-sm text-text-primary hover:bg-surface-raised disabled:opacity-50"
                onClick={() => query.fetchNextPage()}
                disabled={query.isFetchingNextPage}
              >
                {query.isFetchingNextPage ? 'Loading…' : 'Load more'}
              </button>
            </div>
          )}
        </>
      )}
    </ReportPage>
  );
}
