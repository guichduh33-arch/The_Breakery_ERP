// apps/backoffice/src/features/inventory-production/components/ScheduleSlotCell.tsx
//
// Session 15 / Phase 4.B — One cell of the production scheduling grid.
//
// Renders the schedules planned for a specific (date, slot) pair, with status
// pills and a compact "+" affordance to add a new schedule. Click on the
// header opens the per-cell editor pane (parent decides how to render it —
// typically inline expand or modal).

import type { JSX } from 'react';
import type { ScheduleRow, ScheduleSlot } from '../hooks/useProductionSchedule.js';

export interface ScheduleSlotCellProps {
  date:          string; // YYYY-MM-DD
  slot:          ScheduleSlot;
  schedules:     readonly ScheduleRow[];
  onAddClick:    (date: string, slot: ScheduleSlot) => void;
  onScheduleClick: (schedule: ScheduleRow) => void;
}

const STATUS_DOT: Record<ScheduleRow['status'], string> = {
  scheduled: 'bg-text-muted',
  started:   'bg-info',
  completed: 'bg-success',
  cancelled: 'bg-danger',
  skipped:   'bg-warning',
};

const STATUS_PILL: Record<ScheduleRow['status'], string> = {
  scheduled: 'bg-bg-overlay text-text-secondary ring-border-subtle',
  started:   'bg-info-soft text-info ring-info/30',
  completed: 'bg-success-soft text-success ring-success/30',
  cancelled: 'bg-danger-soft text-danger ring-danger/30',
  skipped:   'bg-warning-soft text-warning ring-warning/30',
};

export function ScheduleSlotCell({
  date,
  slot,
  schedules,
  onAddClick,
  onScheduleClick,
}: ScheduleSlotCellProps): JSX.Element {
  const count = schedules.length;
  return (
    <div
      data-testid="schedule-slot-cell"
      data-date={date}
      data-slot={slot}
      className="flex h-full min-h-[88px] flex-col rounded-md border border-border-subtle bg-bg-input p-2 text-xs"
    >
      <div className="mb-1 flex items-center justify-between gap-1">
        <span className="font-mono text-[10px] uppercase tracking-widest text-text-secondary">
          {slot}
        </span>
        <div className="flex items-center gap-1">
          {schedules.map((s) => (
            <span
              key={s.id}
              aria-label={`status ${s.status}`}
              className={`inline-block h-1.5 w-1.5 rounded-full ${STATUS_DOT[s.status]}`}
            />
          ))}
          {count > 0 && (
            <span className="text-[10px] text-text-secondary" aria-label="count">{count}</span>
          )}
        </div>
      </div>

      <ul className="flex-1 space-y-1">
        {schedules.map((s) => (
          <li key={s.id}>
            <button
              type="button"
              onClick={() => onScheduleClick(s)}
              className={`w-full truncate rounded px-1.5 py-0.5 text-left text-[11px] ring-1 ${STATUS_PILL[s.status]}`}
              aria-label={`Schedule ${s.recipeName ?? 'recipe'} ${s.plannedQty}`}
            >
              <span className="font-medium">{s.recipeName ?? 'Recipe'}</span>
              <span className="ml-1 opacity-80">× {s.plannedQty}</span>
            </button>
          </li>
        ))}
      </ul>

      <button
        type="button"
        onClick={() => onAddClick(date, slot)}
        className="mt-1 self-end text-[11px] text-text-secondary hover:text-text-primary"
        aria-label={`Add schedule on ${date} ${slot}`}
      >
        + Add
      </button>
    </div>
  );
}
