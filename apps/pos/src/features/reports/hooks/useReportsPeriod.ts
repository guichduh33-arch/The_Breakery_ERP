// apps/pos/src/features/reports/hooks/useReportsPeriod.ts
//
// Session 14 — Phase 2.D — Period model for the POS reports surface.
//
// Defines the named periods rendered as chips above the report tabs
// (Today / Yesterday / Last 7 days / This week / This month / Custom).
//
// Returns ISO range strings so React Query keys are stable across renders.

import { useMemo, useState } from 'react';

export type ReportsPeriodPreset =
  | 'today'
  | 'yesterday'
  | 'last_7_days'
  | 'this_week'
  | 'this_month'
  | 'custom';

export interface ReportsPeriod {
  preset: ReportsPeriodPreset;
  /** Inclusive ISO start. */
  start: string;
  /** Exclusive ISO end. */
  end: string;
  /** Friendly label for the header subtitle (e.g. "Today", "01 May – 31 May 2026"). */
  label: string;
}

const PRESET_LABELS: Record<ReportsPeriodPreset, string> = {
  today: 'Today',
  yesterday: 'Yesterday',
  last_7_days: 'Last 7 days',
  this_week: 'This week',
  this_month: 'This month',
  custom: 'Custom',
};

function startOfDay(d: Date): Date {
  const x = new Date(d);
  x.setHours(0, 0, 0, 0);
  return x;
}

function startOfWeek(d: Date): Date {
  const x = startOfDay(d);
  const day = x.getDay(); // 0 = Sunday
  // Use ISO week (Monday start) for "this week".
  const diff = (day + 6) % 7;
  x.setDate(x.getDate() - diff);
  return x;
}

function startOfMonth(d: Date): Date {
  const x = startOfDay(d);
  x.setDate(1);
  return x;
}

function addDays(d: Date, n: number): Date {
  const x = new Date(d);
  x.setDate(x.getDate() + n);
  return x;
}

export function resolvePeriod(preset: ReportsPeriodPreset, now = new Date()): ReportsPeriod {
  const start0 = startOfDay(now);
  let start: Date;
  let end: Date;

  switch (preset) {
    case 'yesterday':
      start = addDays(start0, -1);
      end = start0;
      break;
    case 'last_7_days':
      start = addDays(start0, -7);
      end = addDays(start0, 1);
      break;
    case 'this_week':
      start = startOfWeek(now);
      end = addDays(start0, 1);
      break;
    case 'this_month':
      start = startOfMonth(now);
      end = addDays(start0, 1);
      break;
    case 'custom':
      // Custom defaults to last 30 days; consumers should override.
      start = addDays(start0, -30);
      end = addDays(start0, 1);
      break;
    case 'today':
    default:
      start = start0;
      end = addDays(start0, 1);
  }

  return {
    preset,
    start: start.toISOString(),
    end: end.toISOString(),
    label: PRESET_LABELS[preset],
  };
}

export function useReportsPeriod(initial: ReportsPeriodPreset = 'today'): {
  period: ReportsPeriod;
  setPreset: (p: ReportsPeriodPreset) => void;
  presets: ReportsPeriodPreset[];
  labelOf: (p: ReportsPeriodPreset) => string;
} {
  const [preset, setPreset] = useState<ReportsPeriodPreset>(initial);
  const period = useMemo(() => resolvePeriod(preset), [preset]);
  return {
    period,
    setPreset,
    presets: ['today', 'yesterday', 'last_7_days', 'this_week', 'this_month', 'custom'],
    labelOf: (p) => PRESET_LABELS[p],
  };
}
