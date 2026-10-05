// apps/pos/src/features/reports/hooks/useReportsPeriod.ts
//
// Session 14 — Phase 2.D — Period model for the POS reports surface.
//
// Defines the named periods rendered as chips above the report tabs
// (Today / Yesterday / Last 7 days / This week / This month / Custom).
//
// Returns ISO range strings so React Query keys are stable across renders.

import { useEffect, useMemo, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { TIMEZONE } from '@breakery/utils';

export type ReportsPeriodPreset =
  | 'today'
  | 'yesterday'
  | 'last_7_days'
  | 'this_week'
  | 'this_month'
  | 'custom';

export interface ReportsPeriod {
  preset: ReportsPeriodPreset;
  /** Inclusive ISO start (device-local — legacy client-side aggregation). */
  start: string;
  /** Exclusive ISO end (device-local — legacy client-side aggregation). */
  end: string;
  /**
   * Inclusive business-calendar start date (`YYYY-MM-DD`) in the WITA business
   * timezone, independent of the device timezone. Consumed by server RPCs that
   * do their own `AT TIME ZONE` bucketing. This is the timezone-correct path.
   */
  startDate: string;
  /** Inclusive business-calendar end date (`YYYY-MM-DD`) in WITA. */
  endDate: string;
  /** Friendly label for the header subtitle (e.g. "Today", "01 May – 31 May 2026"). */
  label: string;
}

/**
 * Today's calendar date in the business timezone, as a UTC-midnight anchor Date.
 *
 * ADR-019 (D5) — le fuseau vient de la constante client unique (`@breakery/utils`),
 * jamais d'un littéral local : WITA / UTC+8, sans heure d'été, donc l'arithmétique
 * en jours pleins sur une ancre UTC-minuit est exacte.
 */
function witaTodayAnchor(now: Date): Date {
  // en-CA yields `YYYY-MM-DD`; format in WITA regardless of device tz.
  const ymd = new Intl.DateTimeFormat('en-CA', {
    timeZone: TIMEZONE,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(now);
  const parts = ymd.split('-').map(Number);
  const y = parts[0]!;
  const m = parts[1]!;
  const d = parts[2]!;
  return new Date(Date.UTC(y, m - 1, d));
}

function anchorAddDays(anchor: Date, n: number): Date {
  return new Date(anchor.getTime() + n * 86_400_000);
}

/** `YYYY-MM-DD` from a UTC-midnight anchor (slice is safe — no time component). */
function anchorToDateStr(anchor: Date): string {
  return anchor.toISOString().slice(0, 10);
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

  // Timezone-correct business-calendar bounds (WITA), independent of device tz.
  const witaToday = witaTodayAnchor(now);
  let witaStart: Date;
  let witaEnd: Date; // inclusive
  switch (preset) {
    case 'yesterday':
      witaStart = anchorAddDays(witaToday, -1);
      witaEnd = anchorAddDays(witaToday, -1);
      break;
    case 'last_7_days':
      witaStart = anchorAddDays(witaToday, -6); // today + previous 6 = 7 days
      witaEnd = witaToday;
      break;
    case 'this_week': {
      const dow = witaToday.getUTCDay(); // 0 = Sunday
      witaStart = anchorAddDays(witaToday, -((dow + 6) % 7)); // ISO week (Mon)
      witaEnd = witaToday;
      break;
    }
    case 'this_month':
      witaStart = new Date(Date.UTC(witaToday.getUTCFullYear(), witaToday.getUTCMonth(), 1));
      witaEnd = witaToday;
      break;
    case 'custom':
      witaStart = anchorAddDays(witaToday, -29); // default last 30 days
      witaEnd = witaToday;
      break;
    case 'today':
    default:
      witaStart = witaToday;
      witaEnd = witaToday;
  }

  return {
    preset,
    start: start.toISOString(),
    end: end.toISOString(),
    startDate: anchorToDateStr(witaStart),
    endDate: anchorToDateStr(witaEnd),
    label: PRESET_LABELS[preset],
  };
}

const PRESETS: ReportsPeriodPreset[] = ['today', 'yesterday', 'last_7_days', 'this_week', 'this_month', 'custom'];

function validDate(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const date = new Date(`${value}T00:00:00Z`);
  return Number.isFinite(date.getTime()) && date.toISOString().slice(0, 10) === value;
}

export function useReportsPeriod(initial: ReportsPeriodPreset = 'today'): {
  period: ReportsPeriod;
  setPreset: (p: ReportsPeriodPreset) => void;
  presets: ReportsPeriodPreset[];
  labelOf: (p: ReportsPeriodPreset) => string;
  customStart: string;
  customEnd: string;
  setCustomDate: (side: 'start' | 'end', value: string) => void;
  error: string | null;
} {
  const [params, setParams] = useSearchParams();
  const [clock, setClock] = useState(() => new Date());
  useEffect(() => {
    let timer: ReturnType<typeof setTimeout>;
    const refresh = (): void => {
      clearTimeout(timer);
      const now = new Date();
      setClock(now);
      const parts = new Intl.DateTimeFormat('en-GB', { timeZone: TIMEZONE,
        hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23' }).formatToParts(now);
      const part = (type: string): number => Number(parts.find((item) => item.type === type)?.value ?? 0);
      const seconds = part('hour') * 3600 + part('minute') * 60 + part('second');
      timer = setTimeout(refresh, (86_400 - seconds) * 1000 - now.getMilliseconds());
    };
    refresh();
    document.addEventListener('visibilitychange', refresh);
    window.addEventListener('focus', refresh);
    return () => { clearTimeout(timer); document.removeEventListener('visibilitychange', refresh); window.removeEventListener('focus', refresh); };
  }, []);
  const rawPreset = params.get('period');
  const preset = PRESETS.includes(rawPreset as ReportsPeriodPreset) ? rawPreset as ReportsPeriodPreset : initial;
  const defaults = useMemo(() => resolvePeriod('custom', clock), [clock]);
  const customStart = params.get('from') ?? defaults.startDate;
  const customEnd = params.get('to') ?? defaults.endDate;
  const error = preset !== 'custom' ? null : !validDate(customStart) || !validDate(customEnd)
    ? 'Choose valid start and end dates.' : customStart > customEnd ? 'Start date must be on or before end date.' : null;
  const period = useMemo(() => {
    const resolved = resolvePeriod(preset, clock);
    if (preset !== 'custom' || error) return resolved;
    const start = new Date(`${customStart}T00:00:00`);
    const end = addDays(new Date(`${customEnd}T00:00:00`), 1);
    return { ...resolved, startDate: customStart, endDate: customEnd,
      start: start.toISOString(), end: end.toISOString(), label: `${customStart} – ${customEnd}` };
  }, [preset, clock, customStart, customEnd, error]);
  const setPreset = (next: ReportsPeriodPreset): void => {
    setParams((previous) => {
      const nextParams = new URLSearchParams(previous);
      nextParams.set('period', next);
      if (next === 'custom') { nextParams.set('from', customStart); nextParams.set('to', customEnd); }
      return nextParams;
    }, { replace: true });
  };
  const setCustomDate = (side: 'start' | 'end', value: string): void => {
    setParams((previous) => {
      const next = new URLSearchParams(previous);
      next.set('period', 'custom'); next.set(side === 'start' ? 'from' : 'to', value);
      return next;
    }, { replace: true });
  };
  return {
    period,
    setPreset,
    presets: PRESETS,
    labelOf: (p) => PRESET_LABELS[p],
    customStart, customEnd, setCustomDate, error,
  };
}
