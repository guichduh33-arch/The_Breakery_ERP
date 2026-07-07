// apps/backoffice/src/pages/reports/StockMovementHistoryPage.tsx
// 2026-06-18 — stock-card ledger layout (running balance per product) + CSV.
// Full filtered date range via get_stock_movement_ledger_v1 (no cursor); the row cap
// surfaces a truncation banner. PDF intentionally omitted (DEV-S30-4.X-01).

import { useMemo, useState } from 'react';
import { selectClassName, cn } from '@breakery/ui';
import { toLocalDateStr } from '@breakery/domain';
import { ReportPage } from '@/features/reports/components/ReportPage.js';
import { DateRangePicker } from '@/features/reports/components/DateRangePicker.js';
import { ExportButtons } from '@/features/reports/components/ExportButtons.js';
import { useStockLedger } from '@/features/inventory-movements/hooks/useStockLedger.js';
import { StockLedgerTable } from '@/features/inventory-movements/components/StockLedgerTable.js';
import { enrichLedgerLines, stockLedgerCsvColumns } from '@/features/inventory-movements/stockLedgerColumns.js';
import { useUrlState } from '@/hooks/useUrlState.js';

function defaultStart(): string {
  return toLocalDateStr(new Date(Date.now() - 29 * 86_400_000));
}

// Full movement_type enum (V3) — the dropdown lets the user scope the card.
const MOVEMENT_TYPES = [
  'sale', 'sale_void', 'purchase', 'purchase_return', 'incoming',
  'transfer_in', 'transfer_out', 'production_in', 'production_out',
  'adjustment', 'adjustment_in', 'adjustment_out',
  'opname_in', 'opname_out', 'waste', 'cost_price_correction',
  'reservation_hold', 'reservation_release',
];

export default function StockMovementHistoryPage() {
  const [start,      setStart]      = useUrlState('start', defaultStart());
  const [end,        setEnd]        = useUrlState('end', toLocalDateStr(new Date()));
  const [typeFilter, setTypeFilter] = useState<string>('');

  const query = useStockLedger({
    start,
    end,
    movementType: typeFilter || undefined,
  });

  const result = query.data ?? { lines: [], truncated: false, row_count: 0 };
  const rows = useMemo(() => enrichLedgerLines(result.lines), [result.lines]);

  return (
    <ReportPage
      title="Stock Movement History"
      subtitle="Per-product stock card: opening → in/out → balance, with cost and movement value. PDF not available — use CSV export."
      filters={
        <div className="flex flex-wrap items-center gap-3">
          <DateRangePicker
            start={start}
            end={end}
            onStartChange={setStart}
            onEndChange={setEnd}
          />
          <select
            className={cn(selectClassName, 'h-9 w-auto')}
            value={typeFilter}
            onChange={(e) => setTypeFilter(e.target.value)}
            aria-label="Filter by movement type"
          >
            <option value="">All types</option>
            {MOVEMENT_TYPES.map((t) => (
              <option key={t} value={t}>{t}</option>
            ))}
          </select>
          {rows.length > 0 && (
            <ExportButtons
              csv={{ rows, columns: stockLedgerCsvColumns, filename: `stock-movements-${start}_${end}` }}
            />
          )}
        </div>
      }
    >
      {query.error && (
        <p className="text-sm text-danger" role="alert">
          {query.error.message ?? 'Failed to load report.'}
        </p>
      )}
      <StockLedgerTable rows={rows} truncated={result.truncated} isLoading={query.isLoading} />
    </ReportPage>
  );
}
