// apps/backoffice/src/features/inventory-production/components/ProductionCalendarGrid.tsx
//
// Session 15 / Phase 4.B — 7 days x 4 slots production scheduling grid.
//
// Header row : Mon, Tue, …, Sun (with iso date).
// Body : 4 rows of slots ('5am','7am','11am','4pm'), one ScheduleSlotCell
// per (date, slot) intersection. Click on an empty area calls onCellClick ;
// click on a schedule pill calls onScheduleClick.

import type { JSX } from 'react';
import {
  SCHEDULE_SLOTS,
  type ScheduleRow,
  type ScheduleSlot,
  addDays,
  toIsoDate,
} from '../hooks/useProductionSchedule.js';
import { ScheduleSlotCell } from './ScheduleSlotCell.js';

export interface ProductionCalendarGridProps {
  weekStart:        Date; // Monday
  schedules:        readonly ScheduleRow[];
  onCellClick:      (date: string, slot: ScheduleSlot) => void;
  onScheduleClick:  (schedule: ScheduleRow) => void;
}

const DAY_LABELS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'] as const;

export function ProductionCalendarGrid({
  weekStart,
  schedules,
  onCellClick,
  onScheduleClick,
}: ProductionCalendarGridProps): JSX.Element {
  const days = Array.from({ length: 7 }, (_, i) => addDays(weekStart, i));

  // index : date -> slot -> ScheduleRow[]
  const byDateSlot = new Map<string, Map<ScheduleSlot, ScheduleRow[]>>();
  for (const s of schedules) {
    const dayMap = byDateSlot.get(s.scheduledDate) ?? new Map<ScheduleSlot, ScheduleRow[]>();
    const list = dayMap.get(s.slot) ?? [];
    list.push(s);
    dayMap.set(s.slot, list);
    byDateSlot.set(s.scheduledDate, dayMap);
  }

  return (
    <div data-testid="production-calendar-grid" className="overflow-x-auto">
      <div className="grid min-w-[840px] grid-cols-[80px_repeat(7,minmax(110px,1fr))] gap-1">
        {/* header row */}
        <div />
        {days.map((d, i) => {
          const iso = toIsoDate(d);
          return (
            <div
              key={iso}
              data-testid="grid-header"
              data-date={iso}
              className="rounded-md bg-bg-card px-2 py-1 text-center text-xs"
            >
              <div className="font-medium">{DAY_LABELS[i]}</div>
              <div className="text-[10px] text-text-secondary">{iso.slice(5)}</div>
            </div>
          );
        })}

        {/* body : 4 slot rows */}
        {SCHEDULE_SLOTS.map((slot) => (
          <FragmentRow
            key={slot}
            slot={slot}
            days={days}
            byDateSlot={byDateSlot}
            onCellClick={onCellClick}
            onScheduleClick={onScheduleClick}
          />
        ))}
      </div>
    </div>
  );
}

interface FragmentRowProps {
  slot: ScheduleSlot;
  days: Date[];
  byDateSlot: Map<string, Map<ScheduleSlot, ScheduleRow[]>>;
  onCellClick:     (date: string, slot: ScheduleSlot) => void;
  onScheduleClick: (s: ScheduleRow) => void;
}

function FragmentRow({
  slot,
  days,
  byDateSlot,
  onCellClick,
  onScheduleClick,
}: FragmentRowProps): JSX.Element {
  return (
    <>
      <div className="flex items-center justify-end pr-2 font-mono text-[11px] uppercase tracking-widest text-text-secondary">
        {slot}
      </div>
      {days.map((d) => {
        const iso = toIsoDate(d);
        const list = byDateSlot.get(iso)?.get(slot) ?? [];
        return (
          <ScheduleSlotCell
            key={`${iso}-${slot}`}
            date={iso}
            slot={slot}
            schedules={list}
            onAddClick={onCellClick}
            onScheduleClick={onScheduleClick}
          />
        );
      })}
    </>
  );
}
