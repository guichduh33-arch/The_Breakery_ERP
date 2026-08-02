// packages/domain/src/reports/toLocalDateStr.ts
//
// Timezone-aware "YYYY-MM-DD" formatter (fixes audit P2 — `toISOString()` shifts
// across local midnight). Uses Intl.DateTimeFormat with the timeZone option, so
// every consumer (BO filter dates, RPC arguments) designates the same business
// day as the server, whose authority is the PostgreSQL session parameter
// (ADR-019 D1 — `business_config.timezone` mirrors it, it does not rule it).
//
// Pure TS, IO-free. No `format()` from date-fns to avoid an extra dep.
//
// Spec: docs/reference/04-modules/14-reports-analytics.md §22 ("Convention :
// timezone via helper toLocalDateStr").
//
// Examples:
//   toLocalDateStr(new Date('2026-05-14T23:30:00Z'))      // → '2026-05-15' (Asia/Makassar +08)
//   toLocalDateStr('2026-05-14T15:00:00Z', 'UTC')          // → '2026-05-14'

import { TIMEZONE } from '@breakery/utils';

// ADR-019 (D5) : réexport de la constante client unique, déclarée une seule
// fois dans `@breakery/utils`. Ce nom est conservé pour ses consommateurs ;
// ce n'est PAS une seconde déclaration.
export const DEFAULT_TIMEZONE = TIMEZONE;

export function toLocalDateStr(
  input: Date | string | number,
  timeZone: string = DEFAULT_TIMEZONE,
): string {
  const date = input instanceof Date ? input : new Date(input);
  if (Number.isNaN(date.getTime())) {
    throw new TypeError(`toLocalDateStr: invalid date input: ${String(input)}`);
  }

  // Intl returns parts we can stitch into YYYY-MM-DD without surprises.
  // 'en-CA' uses ISO formatting natively, but we build manually for
  // determinism across runtimes (Node vs. browser).
  const parts = new Intl.DateTimeFormat('en-GB', {
    timeZone,
    year:  'numeric',
    month: '2-digit',
    day:   '2-digit',
  }).formatToParts(date);

  const get = (type: Intl.DateTimeFormatPartTypes): string => {
    const part = parts.find((p) => p.type === type);
    return part ? part.value : '';
  };

  return `${get('year')}-${get('month')}-${get('day')}`;
}

/**
 * Returns the first millisecond of the given local date in UTC.
 *  - `toLocalDayStartUTC('2026-05-14')` → Date for `2026-05-13T16:00:00.000Z` (Asia/Makassar +08).
 *
 * Useful when the BO sends a date string filter and we need a TIMESTAMPTZ for
 * the RPC.
 */
export function toLocalDayStartUTC(
  dateStr: string,
  timeZone: string = DEFAULT_TIMEZONE,
): Date {
  // Parse 'YYYY-MM-DD' as a wall-clock date in the target zone. We compute the
  // offset of midnight-in-TZ from UTC by iterating until the formatted output
  // matches the requested wall-clock date. This avoids depending on tzdata.
  const [yStr, mStr, dStr] = dateStr.split('-');
  const y = Number(yStr);
  const m = Number(mStr);
  const d = Number(dStr);
  if (!Number.isInteger(y) || !Number.isInteger(m) || !Number.isInteger(d)) {
    throw new TypeError(`toLocalDayStartUTC: invalid YYYY-MM-DD: ${dateStr}`);
  }

  // Initial guess: midnight UTC of the same Y-M-D.
  let candidate = new Date(Date.UTC(y, m - 1, d, 0, 0, 0));
  // Walk back up to 24h in 1-hour steps until the local-formatted date matches.
  // Worst case is 24 iterations (UTC+14 to UTC-12).
  for (let i = 0; i < 26; i++) {
    if (toLocalDateStr(candidate, timeZone) === dateStr) {
      // Verify it's actually midnight in the target zone (HH:MM).
      const hh = new Intl.DateTimeFormat('en-GB', {
        timeZone, hour: '2-digit', minute: '2-digit', hourCycle: 'h23',
      }).format(candidate);
      if (hh === '00:00') return candidate;
    }
    candidate = new Date(candidate.getTime() - 60 * 60 * 1000);
  }
  // Fallback (should never happen for valid tz strings).
  return new Date(Date.UTC(y, m - 1, d, 0, 0, 0));
}

/**
 * Returns the LAST millisecond of the given local date in UTC — i.e. the
 * inclusive upper bound of that business day.
 *  - `toLocalDayEndUTC('2026-05-14')` → Date for `2026-05-14T15:59:59.999Z` (Asia/Makassar +08).
 *
 * Companion to `toLocalDayStartUTC`, for the many report RPCs that compare a
 * TIMESTAMPTZ column with `BETWEEN`. Computed by walking to the next local
 * midnight and stepping back 1 ms, so it stays correct across a DST boundary
 * instead of assuming a fixed 24 h day.
 */
export function toLocalDayEndUTC(
  dateStr: string,
  timeZone: string = DEFAULT_TIMEZONE,
): Date {
  const dayStart = toLocalDayStartUTC(dateStr, timeZone);
  // +36 h lands inside the next local day whatever the offset shift, then we
  // re-derive that day's midnight exactly.
  const nextDayStr = toLocalDateStr(new Date(dayStart.getTime() + 36 * 3_600_000), timeZone);
  const nextMidnight = toLocalDayStartUTC(nextDayStr, timeZone);
  return new Date(nextMidnight.getTime() - 1);
}
