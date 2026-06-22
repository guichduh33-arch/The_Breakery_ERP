// apps/backoffice/src/features/inventory-production/components/ProductionTodayPanel.tsx
//
// Right column of the redesigned Production page: PRODUCED / WASTE KPI tiles and
// the production log for the selected day + station. Reads production_records
// (date-bounded) and filters to the active station client-side. Reverted records
// are excluded from the KPI totals and dimmed in the list.

import { Clock } from 'lucide-react';
import { useMemo, type JSX } from 'react';
import { Card, EmptyState, SectionLabel } from '@breakery/ui';
import {
  useProductionRecords,
  type ProductionRecordSummary,
} from '../hooks/useProductionRecords.js';

interface Props {
  sectionId: string;
  selectedDate: Date;
}

function startOfDay(d: Date): Date {
  const x = new Date(d);
  x.setHours(0, 0, 0, 0);
  return x;
}
function endOfDay(d: Date): Date {
  const x = new Date(d);
  x.setHours(23, 59, 59, 999);
  return x;
}

export function ProductionTodayPanel({ sectionId, selectedDate }: Props): JSX.Element {
  const fromDate = startOfDay(selectedDate).toISOString();
  const toDate = endOfDay(selectedDate).toISOString();
  const { data, isLoading } = useProductionRecords({ fromDate, toDate });

  const rows = useMemo<ProductionRecordSummary[]>(
    () => (data ?? []).filter((r) => r.section_id === sectionId),
    [data, sectionId],
  );

  const { produced, waste } = useMemo(() => {
    let p = 0;
    let w = 0;
    for (const r of rows) {
      if (r.reverted_at !== null) continue;
      p += r.quantity_produced;
      w += r.quantity_waste;
    }
    return { produced: p, waste: w };
  }, [rows]);

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 gap-4">
        <Card padding="md" className="border-success/30 bg-success-soft/40 text-center">
          <SectionLabel as="div" size="xs" className="text-success">Produced</SectionLabel>
          <div className="mt-2 font-data text-3xl font-semibold text-success" data-testid="kpi-produced">
            {produced.toLocaleString()}
          </div>
        </Card>
        <Card padding="md" className="border-red/30 bg-red-soft/40 text-center">
          <SectionLabel as="div" size="xs" className="text-red">Waste</SectionLabel>
          <div className="mt-2 font-data text-3xl font-semibold text-red" data-testid="kpi-waste">
            {waste.toLocaleString()}
          </div>
        </Card>
      </div>

      <Card padding="md" className="min-h-[20rem]">
        <SectionLabel as="div" size="xs">Today&apos;s Production ({rows.length})</SectionLabel>
        {isLoading ? (
          <div className="py-16 text-center text-sm text-text-muted">Loading…</div>
        ) : rows.length === 0 ? (
          <EmptyState
            icon={Clock}
            size="md"
            title="No production recorded yet"
            description="Submitted batches for this station and day will appear here."
            data-testid="today-production-empty"
          />
        ) : (
          <ul className="mt-3 space-y-2" data-testid="today-production-list">
            {rows.map((r) => (
              <li
                key={r.id}
                className={
                  'flex items-center justify-between gap-3 rounded-lg border border-border-subtle bg-bg-overlay px-3 py-2 text-sm ' +
                  (r.reverted_at !== null ? 'opacity-50' : '')
                }
              >
                <div className="min-w-0">
                  <div className="truncate text-text-primary">{r.product_name ?? r.product_id.slice(0, 8)}</div>
                  <div className="font-mono text-[10px] uppercase tracking-widest text-text-muted">
                    {r.production_number}
                    {r.reverted_at !== null && ' · reverted'}
                  </div>
                </div>
                <div className="shrink-0 text-right font-mono">
                  <div className="text-text-primary">{r.quantity_produced.toLocaleString()}</div>
                  {r.quantity_waste > 0 && (
                    <div className="text-[10px] text-red">−{r.quantity_waste.toLocaleString()} waste</div>
                  )}
                </div>
              </li>
            ))}
          </ul>
        )}
      </Card>
    </div>
  );
}
